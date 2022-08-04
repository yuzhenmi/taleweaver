import { Disposable } from '../../event/emitter';
import {
    connectCrossParentSiblings,
    connectSiblings,
    convertCoordinatesToPositionForHorizontallyFlowingNode,
    describePositionForNodeWithChildren,
} from '../utils';
import { BaseLayoutNode, LayoutPositionLayerDescription, ResolveBoundingBoxesResult } from './base';
import { InlineLayoutNode } from './inline';
import { TextLayoutNode } from './text';

export interface LineLayoutProps {
    readonly width: number;
    readonly lineHeight: number;
}

export interface LineLayout {
    readonly width: number;
    readonly height: number;
    readonly contentHeight: number;
    readonly contentWidth: number;
    readonly trimmedContentWidth: number;
}

export type LineLayoutChildNode = TextLayoutNode | InlineLayoutNode;
export type LineLayoutSiblingNode = LineLayoutNode;

export class LineLayoutNode extends BaseLayoutNode<LineLayoutProps, LineLayout> {
    readonly type = 'line';

    protected internalChildren: LineLayoutChildNode[] = [];
    protected internalFirstChild: LineLayoutChildNode | null = null;
    protected internalLastChild: LineLayoutChildNode | null = null;
    protected internalPreviousSibling: LineLayoutSiblingNode | null = null;
    protected internalNextSibling: LineLayoutSiblingNode | null = null;
    protected internalPreviousCrossParentSibling: LineLayoutSiblingNode | null = null;
    protected internalNextCrossParentSibling: LineLayoutSiblingNode | null = null;
    protected internalSize?: number;
    protected internalContentWidth?: number;
    protected internalContentHeight?: number;
    protected internalTrimmedContentWidth?: number;
    protected internalNeedReflow = true;
    protected childDidUpdateDisposableMap: Map<string, Disposable> = new Map();

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

    setChildren(children: LineLayoutChildNode[]) {
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
                connectSiblings(previousSibling, child);
                connectCrossParentSiblings(previousSibling, child);
            } else {
                connectSiblings(null, child);
                const previousCrossParentSibling = this.internalPreviousCrossParentSibling?.lastChild ?? null;
                connectCrossParentSiblings(previousCrossParentSibling, child);
            }
            if (n < nn - 1) {
                const nextSibling = children[n + 1];
                connectSiblings(child, nextSibling);
                connectCrossParentSiblings(child, nextSibling);
            } else {
                connectSiblings(child, null);
                const nextCrossParentSibling = this.internalNextCrossParentSibling?.firstChild ?? null;
                connectCrossParentSiblings(child, nextCrossParentSibling);
            }
        }
        this.didUpdateEventEmitter.emit({});
    }

    setPreviousSibling(previousSibling: LineLayoutSiblingNode | null) {
        this.internalPreviousSibling = previousSibling;
    }

    setNextSibling(nextSibling: LineLayoutSiblingNode | null) {
        this.internalNextSibling = nextSibling;
    }

    setPreviousCrossParentSibling(previousCrossParentSibling: LineLayoutSiblingNode | null) {
        this.internalPreviousCrossParentSibling = previousCrossParentSibling;
    }

    setNextCrossParentSibling(nextCrossParentSibling: LineLayoutSiblingNode | null) {
        this.internalNextCrossParentSibling = nextCrossParentSibling;
    }

    markAsReflowed() {
        this.internalNeedReflow = false;
    }

    convertCoordinatesToPosition(x: number, y: number) {
        const position = convertCoordinatesToPositionForHorizontallyFlowingNode(
            x,
            y,
            0,
            0,
            this.layout.width,
            this.layout.height,
            this.internalChildren,
        );
        if (position === this.size) {
            return position - 1;
        }
        return position;
    }

    resolveBoundingBoxes(from: number, to: number) {
        if (from < 0 || to > this.size || from > to) {
            throw new Error('Invalid range.');
        }
        const result: ResolveBoundingBoxesResult = {
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

    describePosition(position: number): LayoutPositionLayerDescription[] {
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
