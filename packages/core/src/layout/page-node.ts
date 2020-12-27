import { IDisposable } from '../event/emitter';
import { IBlockLayoutNode } from './block-node';
import { BaseLayoutNode, IBaseLayoutNode, ILayoutPositionLayerDescription, IResolveBoundingBoxesResult } from './node';
import { convertCoordinatesToPositionForVerticallyFlowingNode, describePositionForNodeWithChildren } from './utils';

export interface IPageLayoutProps {
    readonly width: number;
    readonly height: number;
    readonly paddingTop: number;
    readonly paddingBottom: number;
    readonly paddingLeft: number;
    readonly paddingRight: number;
}

export interface IPageLayout {
    readonly width: number;
    readonly height: number;
    readonly paddingTop: number;
    readonly paddingBottom: number;
    readonly paddingLeft: number;
    readonly paddingRight: number;
    readonly contentWidth: number;
    readonly contentHeight: number;
}

export type IPageLayoutNodeChild = IBlockLayoutNode;
export type IPageLayoutNodeSibling = IPageLayoutNode;

export interface IPageLayoutNode extends IBaseLayoutNode<IPageLayoutProps, IPageLayout> {
    readonly type: 'page';
    readonly children: IPageLayoutNodeChild[];
    readonly firstChild: IPageLayoutNodeChild | null;
    readonly lastChild: IPageLayoutNodeChild | null;
    readonly previousSibling: IPageLayoutNodeSibling | null;
    readonly nextSibling: IPageLayoutNodeSibling | null;
    readonly needReflow: boolean;

    setChildren(children: IPageLayoutNodeChild[]): void;
    setPreviousSibling(previousSibling: IPageLayoutNodeSibling | null): void;
    setNextSibling(previousSibling: IPageLayoutNodeSibling | null): void;
    markAsReflowed(): void;
    convertCoordinatesToPosition(x: number, y: number): number;
}

export class PageLayoutNode extends BaseLayoutNode<IPageLayoutProps, IPageLayout> implements IPageLayoutNode {
    readonly type = 'page';

    protected internalChildren: IPageLayoutNodeChild[] = [];
    protected internalFirstChild: IPageLayoutNodeChild | null = null;
    protected internalLastChild: IPageLayoutNodeChild | null = null;
    protected internalPreviousSibling: IPageLayoutNodeSibling | null = null;
    protected internalNextSibling: IPageLayoutNodeSibling | null = null;
    protected internalPreviousCrossParentSibling: IPageLayoutNodeSibling | null = null;
    protected internalNextCrossParentSibling: IPageLayoutNodeSibling | null = null;
    protected internalSize?: number;
    protected internalNeedReflow = true;
    protected childDidUpdateDisposableMap: Map<string, IDisposable> = new Map();

    constructor() {
        super();
        this.onDidUpdate(() => {
            this.internalSize = undefined;
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

    setChildren(children: IPageLayoutNodeChild[]) {
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

    setPreviousSibling(previousSibling: IPageLayoutNodeSibling | null) {
        this.internalPreviousSibling = previousSibling;
    }

    setNextSibling(nextSibling: IPageLayoutNodeSibling | null) {
        this.internalNextSibling = nextSibling;
    }

    setPreviousCrossParentSibling(previousCrossParentSibling: IPageLayoutNodeSibling | null) {
        this.internalPreviousCrossParentSibling = previousCrossParentSibling;
    }

    setNextCrossParentSibling(nextCrossParentSibling: IPageLayoutNodeSibling | null) {
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
        const result: IResolveBoundingBoxesResult = {
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

    describePosition(position: number): ILayoutPositionLayerDescription[] {
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
