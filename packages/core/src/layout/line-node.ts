import { IDisposable } from '../event/emitter';
import { IInlineLayoutNode } from './inline-node';
import { BaseLayoutNode, IBaseLayoutNode, ILayoutPositionLayerDescription, IResolveBoundingBoxesResult } from './node';
import { ITextLayoutNode } from './text-node';
import { convertCoordinatesToPositionForHorizontallyFlowingNode, describePositionForNodeWithChildren } from './utils';

export interface ILineLayoutProps {
    readonly width: number;
    readonly lineHeight: number;
}

export interface ILineLayout {
    readonly width: number;
    readonly height: number;
    readonly contentHeight: number;
    readonly contentWidth: number;
    readonly trimmedContentWidth: number;
}

export type ILineLayoutNodeChild = ITextLayoutNode | IInlineLayoutNode;
export type ILineLayoutNodeSibling = ILineLayoutNode;

export interface ILineLayoutNode extends IBaseLayoutNode<ILineLayoutProps, ILineLayout> {
    readonly type: 'line';
    readonly children: ILineLayoutNodeChild[];
    readonly firstChild: ILineLayoutNodeChild | null;
    readonly lastChild: ILineLayoutNodeChild | null;
    readonly previousSibling: ILineLayoutNodeSibling | null;
    readonly nextSibling: ILineLayoutNodeSibling | null;
    readonly previousCrossParentSibling: ILineLayoutNodeSibling | null;
    readonly nextCrossParentSibling: ILineLayoutNodeSibling | null;
    readonly needReflow: boolean;

    setChildren(children: ILineLayoutNodeChild[]): void;
    setPreviousSibling(previousSibling: ILineLayoutNodeSibling | null): void;
    setNextSibling(previousSibling: ILineLayoutNodeSibling | null): void;
    setPreviousCrossParentSibling(previousCrossParentSibling: ILineLayoutNodeSibling | null): void;
    setNextCrossParentSibling(previousCrossParentSibling: ILineLayoutNodeSibling | null): void;
    markAsReflowed(): void;
    convertCoordinatesToPosition(x: number, y: number): number;
}

export class LineLayoutNode extends BaseLayoutNode<ILineLayoutProps, ILineLayout> implements ILineLayoutNode {
    readonly type = 'line';

    protected internalChildren: ILineLayoutNodeChild[] = [];
    protected internalFirstChild: ILineLayoutNodeChild | null = null;
    protected internalLastChild: ILineLayoutNodeChild | null = null;
    protected internalPreviousSibling: ILineLayoutNodeSibling | null = null;
    protected internalNextSibling: ILineLayoutNodeSibling | null = null;
    protected internalPreviousCrossParentSibling: ILineLayoutNodeSibling | null = null;
    protected internalNextCrossParentSibling: ILineLayoutNodeSibling | null = null;
    protected internalSize?: number;
    protected internalContentWidth?: number;
    protected internalContentHeight?: number;
    protected internalTrimmedContentWidth?: number;
    protected internalNeedReflow = true;
    protected childDidUpdateDisposableMap: Map<string, IDisposable> = new Map();

    constructor() {
        super();
        this.onDidUpdate(() => {
            this.internalSize = undefined;
            this.internalContentWidth = undefined;
            this.internalContentHeight = undefined;
            this.internalTrimmedContentWidth = undefined;
            this.internalNeedReflow = true;
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

    get needReflow() {
        return this.internalNeedReflow;
    }

    setChildren(children: ILineLayoutNodeChild[]) {
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
                const previousCrossParentSibling = this.internalPreviousCrossParentSibling?.lastChild ?? null;
                child.setPreviousCrossParentSibling(previousCrossParentSibling);
                previousCrossParentSibling?.setNextCrossParentSibling(child);
            }
            if (n < nn - 1) {
                const nextSibling = children[n + 1];
                child.setNextSibling(nextSibling);
                child.setNextCrossParentSibling(nextSibling);
            } else {
                child.setNextSibling(null);
                child.nextCrossParentSibling?.setPreviousCrossParentSibling(null);
                const nextCrossParentSibling = this.internalNextCrossParentSibling?.firstChild ?? null;
                child.setNextCrossParentSibling(nextCrossParentSibling);
                nextCrossParentSibling?.setPreviousCrossParentSibling(child);
            }
        }
        this.didUpdateEventEmitter.emit({});
    }

    setPreviousSibling(previousSibling: ILineLayoutNodeSibling | null) {
        this.internalPreviousSibling = previousSibling;
    }

    setNextSibling(nextSibling: ILineLayoutNodeSibling | null) {
        this.internalNextSibling = nextSibling;
    }

    setPreviousCrossParentSibling(previousCrossParentSibling: ILineLayoutNodeSibling | null) {
        this.internalPreviousCrossParentSibling = previousCrossParentSibling;
    }

    setNextCrossParentSibling(nextCrossParentSibling: ILineLayoutNodeSibling | null) {
        this.internalNextCrossParentSibling = nextCrossParentSibling;
    }

    markAsReflowed() {
        this.internalNeedReflow = false;
    }

    convertCoordinatesToPosition(x: number, y: number) {
        return convertCoordinatesToPositionForHorizontallyFlowingNode(
            x,
            y,
            0,
            0,
            this.layout.width,
            this.layout.height,
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
            height: from === to ? this.layout.contentHeight : this.layout.height,
            left: left1!,
            right: this.layout.width - left2!,
            top: 0,
            bottom: 0,
        });
        return result;
    }

    describePosition(position: number): ILayoutPositionLayerDescription[] {
        return describePositionForNodeWithChildren(this, position);
    }

    protected get contentWidth() {
        if (this.internalContentWidth === undefined) {
            this.internalContentWidth = this.calculateContentWidth();
        }
        return this.internalContentWidth;
    }

    protected get contentHeight() {
        if (this.internalContentHeight === undefined) {
            this.internalContentHeight = this.calculateContentHeight();
        }
        return this.internalContentHeight;
    }

    protected get trimmedContentWidth() {
        if (this.internalTrimmedContentWidth === undefined) {
            this.internalTrimmedContentWidth = this.calculateTrimmedContentWidth();
        }
        return this.internalTrimmedContentWidth;
    }

    protected buildLayout() {
        const props = this.layoutProps;
        return {
            width: props.width,
            height: this.contentHeight * props.lineHeight,
            contentWidth: this.contentWidth,
            contentHeight: this.contentHeight,
            trimmedContentWidth: this.trimmedContentWidth,
        };
    }

    protected calculateSize() {
        return this.internalChildren.reduce((size, child) => size + child.size, 0);
    }

    protected calculateContentHeight() {
        return this.internalChildren.reduce((height, child) => Math.max(height, child.layout.height), 0);
    }

    protected calculateContentWidth() {
        return this.internalChildren.reduce((width, child) => width + child.layout.width, 0);
    }

    protected calculateTrimmedContentWidth() {
        let trimmedWidth = 0;
        for (let n = 0, nn = this.internalChildren.length - 1; n < nn; n++) {
            trimmedWidth += this.internalChildren[n].layout.width;
        }
        if (this.internalChildren.length > 0) {
            const lastChild = this.internalChildren[this.internalChildren.length - 1];
            if (lastChild.type === 'text') {
                trimmedWidth += lastChild.layout.trimmedWidth;
            }
        }
        return trimmedWidth;
    }

    protected handleChildDidUpdate = () => {
        this.didUpdateEventEmitter.emit({});
    };
}
