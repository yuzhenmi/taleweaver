import { IDisposable } from '../event/emitter';
import { IInlineLayoutNode } from './inline-node';
import { BaseLayoutNode, IBaseLayoutNode, ILayoutPositionLayerDescription, IResolveBoundingBoxesResult } from './node';
import { convertCoordinatesToPositionForHorizontallyFlowingNode, describePositionForNodeWithChildren } from './utils';
import { IWordLayoutNode, IWordLayoutNodeSibling } from './word-node';

export interface ITextLayoutProps {
    weight: number;
    size: number;
    family: string;
    letterSpacing: number;
    underline: boolean;
    italic: boolean;
    strikethrough: boolean;
    color: string;
}

export interface ITextLayout {
    width: number;
    height: number;
    trimmedWidth: number;
    weight: number;
    size: number;
    family: string;
    letterSpacing: number;
    underline: boolean;
    italic: boolean;
    strikethrough: boolean;
    color: string;
}

export type ITextLayoutNodeChild = IWordLayoutNode;
export type ITextLayoutNodeSibling = ITextLayoutNode | IInlineLayoutNode;

export interface ITextLayoutNode extends IBaseLayoutNode<ITextLayoutProps, ITextLayout> {
    readonly type: 'text';
    readonly renderId: string;
    readonly children: ITextLayoutNodeChild[];
    readonly firstChild: ITextLayoutNodeChild | null;
    readonly lastChild: ITextLayoutNodeChild | null;
    readonly previousSibling: ITextLayoutNodeSibling | null;
    readonly nextSibling: ITextLayoutNodeSibling | null;
    readonly previousCrossParentSibling: ITextLayoutNodeSibling | null;
    readonly nextCrossParentSibling: ITextLayoutNodeSibling | null;

    setChildren(children: ITextLayoutNodeChild[]): void;
    setPreviousSibling(previousSibling: ITextLayoutNodeSibling | null): void;
    setNextSibling(previousSibling: ITextLayoutNodeSibling | null): void;
    setPreviousCrossParentSibling(previousCrossParentSibling: ITextLayoutNodeSibling | null): void;
    setNextCrossParentSibling(previousCrossParentSibling: ITextLayoutNodeSibling | null): void;
    convertCoordinatesToPosition(x: number, y: number): number;
}

export class TextLayoutNode extends BaseLayoutNode<ITextLayoutProps, ITextLayout> implements ITextLayoutNode {
    readonly type = 'text';

    protected internalChildren: ITextLayoutNodeChild[] = [];
    protected internalFirstChild: ITextLayoutNodeChild | null = null;
    protected internalLastChild: ITextLayoutNodeChild | null = null;
    protected internalPreviousSibling: ITextLayoutNodeSibling | null = null;
    protected internalNextSibling: ITextLayoutNodeSibling | null = null;
    protected internalPreviousCrossParentSibling: ITextLayoutNodeSibling | null = null;
    protected internalNextCrossParentSibling: ITextLayoutNodeSibling | null = null;
    protected internalSize?: number;
    protected internalWidth?: number;
    protected internalHeight?: number;
    protected internalTrimmedWidth?: number;
    protected childDidUpdateDisposableMap: Map<string, IDisposable> = new Map();

    constructor(readonly renderId: string) {
        super();
        this.onDidUpdate(() => {
            this.internalSize = undefined;
            this.internalWidth = undefined;
            this.internalHeight = undefined;
            this.internalTrimmedWidth = undefined;
        });
    }

    get children() {
        return this.internalChildren.slice();
    }

    get firstChild() {
        return this.internalFirstChild;
    }

    get lastChild() {
        return this.internalLastChild;
    }

    get previousSibling() {
        return this.internalPreviousSibling;
    }

    get nextSibling() {
        return this.internalNextSibling;
    }

    get previousCrossParentSibling() {
        return this.internalPreviousCrossParentSibling;
    }

    get nextCrossParentSibling() {
        return this.internalNextCrossParentSibling;
    }

    get size() {
        if (this.internalSize === undefined) {
            this.internalSize = this.calculateSize();
        }
        return this.internalSize;
    }

    setChildren(children: ITextLayoutNodeChild[]) {
        this.childDidUpdateDisposableMap.forEach((disposable) => disposable.dispose());
        this.childDidUpdateDisposableMap.clear();
        children.forEach((child) =>
            this.childDidUpdateDisposableMap.set(child.id, child.onDidUpdate(this.handleChildDidUpdate)),
        );
        this.internalChildren = children;
        if (children.length > 0) {
            this.internalFirstChild = children[0];
            this.internalLastChild = children[children.length - 1];
        } else {
            this.internalFirstChild = null;
            this.internalLastChild = null;
        }
        for (let n = 0, nn = children.length; n < nn; n++) {
            const child = children[n];
            if (n > 0) {
                const previousSibling = children[n - 1];
                child.setPreviousSibling(previousSibling);
                child.setPreviousCrossParentSibling(previousSibling);
            } else {
                child.setPreviousSibling(null);
                child.previousCrossParentSibling?.setNextCrossParentSibling(null);
                let previousCrossParentSibling: IWordLayoutNodeSibling | null = null;
                switch (this.internalPreviousCrossParentSibling?.type) {
                    case 'text':
                        previousCrossParentSibling = this.internalPreviousCrossParentSibling.lastChild;
                        break;
                    case 'inline':
                        previousCrossParentSibling = this.internalPreviousCrossParentSibling;
                        break;
                }
                child.setPreviousCrossParentSibling(previousCrossParentSibling);
                switch (previousCrossParentSibling?.type) {
                    case 'word':
                        previousCrossParentSibling.setNextCrossParentSibling(child);
                        break;
                    case 'inline':
                        previousCrossParentSibling.setNextCrossParentContentSibling(child);
                        break;
                }
            }
            if (n < nn - 1) {
                const nextSibling = children[n + 1];
                child.setNextSibling(nextSibling);
                child.setNextCrossParentSibling(nextSibling);
            } else {
                child.setNextSibling(null);
                child.nextCrossParentSibling?.setPreviousCrossParentSibling(null);
                let nextCrossParentSibling: IWordLayoutNodeSibling | null = null;
                switch (this.internalNextCrossParentSibling?.type) {
                    case 'text':
                        nextCrossParentSibling = this.internalNextCrossParentSibling.firstChild;
                        break;
                    case 'inline':
                        nextCrossParentSibling = this.internalNextCrossParentSibling;
                        break;
                }
                child.setNextCrossParentSibling(nextCrossParentSibling);
                switch (nextCrossParentSibling?.type) {
                    case 'word':
                        nextCrossParentSibling.setPreviousCrossParentSibling(child);
                        break;
                    case 'inline':
                        nextCrossParentSibling.setPreviousCrossParentContentSibling(child);
                        break;
                }
            }
        }
        this.didUpdateEventEmitter.emit({});
    }

    setPreviousSibling(previousSibling: ITextLayoutNodeSibling | null) {
        this.internalPreviousSibling = previousSibling;
    }

    setNextSibling(nextSibling: ITextLayoutNodeSibling | null) {
        this.internalNextSibling = nextSibling;
    }

    setPreviousCrossParentSibling(previousCrossParentSibling: ITextLayoutNodeSibling | null) {
        this.internalPreviousCrossParentSibling = previousCrossParentSibling;
    }

    setNextCrossParentSibling(nextCrossParentSibling: ITextLayoutNodeSibling | null) {
        this.internalNextCrossParentSibling = nextCrossParentSibling;
    }

    convertCoordinatesToPosition(x: number, y: number) {
        return convertCoordinatesToPositionForHorizontallyFlowingNode(
            x,
            y,
            0,
            0,
            this.width,
            this.height,
            this.internalChildren,
        );
    }

    resolveBoundingBoxes(from: number, to: number) {
        if (from < 0 || to > this.size || from > to) {
            throw new Error('Invalid range.');
        }
        const result: IResolveBoundingBoxesResult = {
            node: this,
            boundingBoxes: [],
            children: [],
        };
        let cumulatedOffset = 0;
        let left1: number | null = null;
        let left2 = 0;
        for (const child of this.internalChildren) {
            if (cumulatedOffset > to) {
                break;
            }
            if (cumulatedOffset + child.size > from) {
                const childFrom = Math.max(0, from - cumulatedOffset);
                const childTo = Math.min(child.size, to - cumulatedOffset);
                const resolvedChild = child.resolveBoundingBoxes(childFrom, childTo);
                result.children.push(resolvedChild);
                if (left1 === null) {
                    left1 = left2 + resolvedChild.boundingBoxes[0].left;
                }
                left2 += resolvedChild.boundingBoxes
                    .slice(0, resolvedChild.boundingBoxes.length - 1)
                    .reduce((width, box) => width + box.left + box.width + box.right, 0);
                left2 += resolvedChild.boundingBoxes[0].left + resolvedChild.boundingBoxes[0].width;
            } else {
                left2 += child.layout.width;
            }
            cumulatedOffset += child.size;
        }
        result.boundingBoxes.push({
            from,
            to,
            width: left2! - left1!,
            height: this.height,
            left: left1!,
            right: this.width - left2!,
            top: 0,
            bottom: 0,
        });
        return result;
    }

    describePosition(position: number): ILayoutPositionLayerDescription[] {
        return describePositionForNodeWithChildren(this, position);
    }

    protected get width() {
        if (this.internalWidth === undefined) {
            this.internalWidth = this.calculateWidth();
        }
        return this.internalWidth;
    }

    protected get height() {
        if (this.internalHeight === undefined) {
            this.internalHeight = this.calculateHeight();
        }
        return this.internalHeight;
    }

    protected get trimmedWidth() {
        if (this.internalTrimmedWidth === undefined) {
            this.internalTrimmedWidth = this.calculateTrimmedWidth();
        }
        return this.internalTrimmedWidth;
    }

    protected buildLayout() {
        return {
            width: this.width,
            height: this.height,
            trimmedWidth: this.trimmedWidth,
            weight: this.layoutProps.weight,
            size: this.layoutProps.size,
            family: this.layoutProps.family,
            letterSpacing: this.layoutProps.letterSpacing,
            underline: this.layoutProps.underline,
            italic: this.layoutProps.italic,
            strikethrough: this.layoutProps.strikethrough,
            color: this.layoutProps.color,
        };
    }

    protected calculateSize() {
        return this.internalChildren.reduce((size, child) => size + child.size, 0);
    }

    protected calculateWidth() {
        return this.internalChildren.reduce((width, child) => width + child.layout.width, 0);
    }

    protected calculateHeight() {
        return this.internalChildren.reduce((height, child) => Math.max(height, child.layout.height), 0);
    }

    protected calculateTrimmedWidth() {
        let trimmedWidth = 0;
        for (let n = 0, nn = this.internalChildren.length - 1; n < nn; n++) {
            trimmedWidth += this.internalChildren[n].layout.width;
        }
        if (this.internalChildren.length > 0) {
            const lastChild = this.internalChildren[this.internalChildren.length - 1];
            trimmedWidth += lastChild.layout.trimmedWidth;
        }
        return trimmedWidth;
    }

    protected handleChildDidUpdate = () => {
        this.didUpdateEventEmitter.emit({});
    };
}
