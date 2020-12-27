import { IDisposable } from '../event/emitter';
import { ILineLayoutNode } from './line-node';
import { BaseLayoutNode, IBaseLayoutNode, ILayoutPositionLayerDescription, IResolveBoundingBoxesResult } from './node';
import { convertCoordinatesToPositionForVerticallyFlowingNode, describePositionForNodeWithChildren } from './utils';

export interface IBlockLayoutProps {
    readonly width: number;
    readonly paddingTop: number;
    readonly paddingBottom: number;
    readonly paddingLeft: number;
    readonly paddingRight: number;
}

export interface IBlockLayout {
    readonly width: number;
    readonly height: number;
    readonly paddingTop: number;
    readonly paddingBottom: number;
    readonly paddingLeft: number;
    readonly paddingRight: number;
    readonly contentWidth: number;
    readonly contentHeight: number;
}

export type IBlockLayoutNodeChild = ILineLayoutNode;
export type IBlockLayoutNodeSibling = IBlockLayoutNode;

export interface IBlockLayoutNode extends IBaseLayoutNode<IBlockLayoutProps, IBlockLayout> {
    readonly type: 'block';
    readonly renderId: string;
    readonly children: IBlockLayoutNodeChild[];
    readonly firstChild: IBlockLayoutNodeChild | null;
    readonly lastChild: IBlockLayoutNodeChild | null;
    readonly previousSibling: IBlockLayoutNodeSibling | null;
    readonly nextSibling: IBlockLayoutNodeSibling | null;
    readonly previousCrossParentSibling: IBlockLayoutNodeSibling | null;
    readonly nextCrossParentSibling: IBlockLayoutNodeSibling | null;
    readonly needReflow: boolean;

    setChildren(children: IBlockLayoutNodeChild[]): void;
    setPreviousSibling(previousSibling: IBlockLayoutNodeSibling | null): void;
    setNextSibling(previousSibling: IBlockLayoutNodeSibling | null): void;
    setPreviousCrossParentSibling(previousCrossParentSibling: IBlockLayoutNodeSibling | null): void;
    setNextCrossParentSibling(previousCrossParentSibling: IBlockLayoutNodeSibling | null): void;
    markAsReflowed(): void;
    convertCoordinatesToPosition(x: number, y: number): number;
}

export class BlockLayoutNode extends BaseLayoutNode<IBlockLayoutProps, IBlockLayout> implements IBlockLayoutNode {
    readonly type = 'block';

    protected internalChildren: IBlockLayoutNodeChild[] = [];
    protected internalFirstChild: IBlockLayoutNodeChild | null = null;
    protected internalLastChild: IBlockLayoutNodeChild | null = null;
    protected internalPreviousSibling: IBlockLayoutNodeSibling | null = null;
    protected internalNextSibling: IBlockLayoutNodeSibling | null = null;
    protected internalPreviousCrossParentSibling: IBlockLayoutNodeSibling | null = null;
    protected internalNextCrossParentSibling: IBlockLayoutNodeSibling | null = null;
    protected internalSize?: number;
    protected internalHeight?: number;
    protected internalNeedReflow = true;
    protected childDidUpdateDisposableMap: Map<string, IDisposable> = new Map();

    constructor(readonly renderId: string) {
        super();
        this.onDidUpdate(() => {
            this.internalSize = undefined;
            this.internalHeight = undefined;
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

    setChildren(children: IBlockLayoutNodeChild[]) {
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

    setPreviousSibling(previousSibling: IBlockLayoutNodeSibling | null) {
        this.internalPreviousSibling = previousSibling;
    }

    setNextSibling(nextSibling: IBlockLayoutNodeSibling | null) {
        this.internalNextSibling = nextSibling;
    }

    setPreviousCrossParentSibling(previousCrossParentSibling: IBlockLayoutNodeSibling | null) {
        this.internalPreviousCrossParentSibling = previousCrossParentSibling;
    }

    setNextCrossParentSibling(nextCrossParentSibling: IBlockLayoutNodeSibling | null) {
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
                const childResult = child.resolveBoundingBoxes(childFrom, childTo);
                result.children.push(childResult);
                for (const boundingBox of childResult.boundingBoxes) {
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
                        left: boundingBox.left,
                        right: boundingBox.right,
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

    protected get height() {
        if (this.internalHeight === undefined) {
            this.internalHeight = this.calculateHeight();
        }
        return this.internalHeight;
    }

    protected buildLayout() {
        const props = this.layoutProps;
        return {
            width: props.width,
            height: this.height,
            paddingTop: props.paddingTop,
            paddingBottom: props.paddingBottom,
            paddingLeft: props.paddingLeft,
            paddingRight: props.paddingRight,
            contentWidth: props.width - props.paddingLeft - props.paddingRight,
            contentHeight: this.height - props.paddingTop - props.paddingBottom,
        };
    }

    protected calculateSize() {
        return this.internalChildren.reduce((size, child) => size + child.size, 0);
    }

    protected calculateHeight() {
        return this.internalChildren.reduce((height, child) => height + child.layout.height, 0);
    }

    protected handleChildDidUpdate = () => {
        this.didUpdateEventEmitter.emit({});
    };
}
