import { Disposable } from '../../event/emitter';
import {
    connectCrossParentSiblings,
    connectSiblings,
    convertCoordinatesToPositionForVerticallyFlowingNode,
    describePositionForNodeWithChildren,
} from '../utils';
import { BaseLayoutNode, LayoutPositionLayerDescription, ResolveBoundingBoxesResult } from './base';
import { BlockLayoutNode } from './block';

export interface PageLayoutProps {
    readonly width: number;
    readonly height: number;
    readonly paddingTop: number;
    readonly paddingBottom: number;
    readonly paddingLeft: number;
    readonly paddingRight: number;
}

export interface PageLayout {
    readonly width: number;
    readonly height: number;
    readonly paddingTop: number;
    readonly paddingBottom: number;
    readonly paddingLeft: number;
    readonly paddingRight: number;
    readonly contentWidth: number;
    readonly contentHeight: number;
}

export type PageLayoutChildNode = BlockLayoutNode;
export type PageLayoutSiblingNode = PageLayoutNode;

export class PageLayoutNode extends BaseLayoutNode<PageLayoutProps, PageLayout> {
    readonly type = 'page';

    protected internalChildren: PageLayoutChildNode[] = [];
    protected internalFirstChild: PageLayoutChildNode | null = null;
    protected internalLastChild: PageLayoutChildNode | null = null;
    protected internalPreviousSibling: PageLayoutSiblingNode | null = null;
    protected internalNextSibling: PageLayoutSiblingNode | null = null;
    protected internalPreviousCrossParentSibling: PageLayoutSiblingNode | null = null;
    protected internalNextCrossParentSibling: PageLayoutSiblingNode | null = null;
    protected internalSize?: number;
    protected internalNeedReflow = true;
    protected childDidUpdateDisposableMap: Map<string, Disposable> = new Map();

    constructor() {
        super();
        this.onDidUpdate(() => {
            this.internalSize = undefined;
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

    setChildren(children: PageLayoutChildNode[]) {
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

    setPreviousSibling(previousSibling: PageLayoutSiblingNode | null) {
        this.internalPreviousSibling = previousSibling;
    }

    setNextSibling(nextSibling: PageLayoutSiblingNode | null) {
        this.internalNextSibling = nextSibling;
    }

    setPreviousCrossParentSibling(previousCrossParentSibling: PageLayoutSiblingNode | null) {
        this.internalPreviousCrossParentSibling = previousCrossParentSibling;
    }

    setNextCrossParentSibling(nextCrossParentSibling: PageLayoutSiblingNode | null) {
        this.internalNextCrossParentSibling = nextCrossParentSibling;
    }

    markAsReflowed() {
        this.internalNeedReflow = false;
    }

    convertCoordinatesToPosition(x: number, y: number) {
        return convertCoordinatesToPositionForVerticallyFlowingNode(
            x,
            y,
            this.layout.paddingLeft,
            this.layout.paddingTop,
            this.layout.contentWidth,
            this.layout.contentHeight,
            this.internalChildren,
        );
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
        let cumulatedHeight = 0;
        for (const child of this.internalChildren) {
            if (cumulatedOffset + child.size > from && cumulatedOffset <= to) {
                const childFrom = Math.max(0, from - cumulatedOffset);
                const childTo = Math.min(child.size, to - cumulatedOffset);
                const resolvedChild = child.resolveBoundingBoxes(childFrom, childTo);
                result.children.push(resolvedChild);
                for (const boundingBox of resolvedChild.boundingBoxes) {
                    result.boundingBoxes.push({
                        from: cumulatedOffset + childFrom,
                        to: cumulatedOffset + childTo,
                        width: boundingBox.width,
                        height: boundingBox.height,
                        top: cumulatedHeight + this.layout.paddingTop + boundingBox.top,
                        bottom:
                            this.layout.height -
                            this.layout.paddingTop -
                            cumulatedHeight -
                            child.layout.height +
                            boundingBox.bottom,
                        left: boundingBox.left + this.layout.paddingLeft,
                        right: boundingBox.right + this.layout.paddingRight,
                    });
                }
            }
            cumulatedOffset += child.size;
            cumulatedHeight += child.layout.height;
        }
        return result;
    }

    describePosition(position: number): LayoutPositionLayerDescription[] {
        return describePositionForNodeWithChildren(this, position);
    }

    protected buildLayout() {
        const props = this.layoutProps;
        return {
            width: props.width,
            height: props.height,
            paddingTop: props.paddingTop,
            paddingBottom: props.paddingBottom,
            paddingLeft: props.paddingLeft,
            paddingRight: props.paddingRight,
            contentWidth: props.width - props.paddingLeft - props.paddingRight,
            contentHeight: props.height - props.paddingTop - props.paddingBottom,
        };
    }

    protected calculateSize() {
        return this.internalChildren.reduce((size, child) => size + child.size, 0);
    }

    protected handleChildDidUpdate = () => {
        this.didUpdateEventEmitter.emit({});
    };
}
