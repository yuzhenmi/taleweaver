import { ITextLayoutNode } from './text-node';
import { IWordLayoutNode } from './word-node';
import { IBaseLayoutNode, BaseLayoutNode, ILayoutPositionLayerDescription, IResolveBoundingBoxesResult } from './node';

export interface IInlineLayoutProps {
    readonly width: number;
    readonly height: number;
}

export interface IInlineLayout {
    readonly width: number;
    readonly height: number;
}

export type IInlineLayoutNodeSibling = IInlineLayoutNode | ITextLayoutNode;
export type IInlineLayoutNodeContentSibling = IInlineLayoutNode | IWordLayoutNode;

export interface IInlineLayoutNode extends IBaseLayoutNode<IInlineLayoutProps, IInlineLayout> {
    readonly type: 'inline';
    readonly renderId: string;
    readonly previousSibling: IInlineLayoutNodeSibling | null;
    readonly nextSibling: IInlineLayoutNodeSibling | null;
    readonly previousCrossParentSibling: IInlineLayoutNodeSibling | null;
    readonly nextCrossParentSibling: IInlineLayoutNodeSibling | null;
    readonly previousContentSibling: IInlineLayoutNodeContentSibling | null;
    readonly nextContentSibling: IInlineLayoutNodeContentSibling | null;
    readonly previousCrossParentContentSibling: IInlineLayoutNodeContentSibling | null;
    readonly nextCrossParentContentSibling: IInlineLayoutNodeContentSibling | null;
    readonly trimmedSize: 1;

    setPreviousSibling(previousSibling: IInlineLayoutNodeSibling | null): void;
    setNextSibling(previousSibling: IInlineLayoutNodeSibling | null): void;
    setPreviousCrossParentSibling(previousCrossParentSibling: IInlineLayoutNodeSibling | null): void;
    setNextCrossParentSibling(previousCrossParentSibling: IInlineLayoutNodeSibling | null): void;
    setPreviousContentSibling(previousSibling: IInlineLayoutNodeContentSibling | null): void;
    setNextContentSibling(previousSibling: IInlineLayoutNodeContentSibling | null): void;
    setPreviousCrossParentContentSibling(previousCrossParentSibling: IInlineLayoutNodeContentSibling | null): void;
    setNextCrossParentContentSibling(previousCrossParentSibling: IInlineLayoutNodeContentSibling | null): void;
    convertCoordinatesToPosition(x: number, y: number): number;
}

export class InlineLayoutNode extends BaseLayoutNode<IInlineLayoutProps, IInlineLayout> implements IInlineLayoutNode {
    readonly type = 'inline';
    protected internalPreviousSibling: IInlineLayoutNodeSibling | null = null;
    protected internalNextSibling: IInlineLayoutNodeSibling | null = null;
    protected internalPreviousCrossParentSibling: IInlineLayoutNodeSibling | null = null;
    protected internalNextCrossParentSibling: IInlineLayoutNodeSibling | null = null;
    protected internalPreviousContentSibling: IInlineLayoutNodeContentSibling | null = null;
    protected internalNextContentSibling: IInlineLayoutNodeContentSibling | null = null;
    protected internalPreviousCrossParentContentSibling: IInlineLayoutNodeContentSibling | null = null;
    protected internalNextCrossParentContentSibling: IInlineLayoutNodeContentSibling | null = null;
    readonly size = 1;
    readonly trimmedSize = 1;

    constructor(readonly renderId: string) {
        super();
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

    get previousContentSibling() {
        return this.internalPreviousContentSibling;
    }

    get nextContentSibling() {
        return this.internalNextContentSibling;
    }

    get previousCrossParentContentSibling() {
        return this.internalPreviousCrossParentContentSibling;
    }

    get nextCrossParentContentSibling() {
        return this.internalNextCrossParentContentSibling;
    }

    setPreviousSibling(previousSibling: IInlineLayoutNodeSibling | null) {
        this.internalPreviousSibling = previousSibling;
    }

    setNextSibling(nextSibling: IInlineLayoutNodeSibling | null) {
        this.internalNextSibling = nextSibling;
    }

    setPreviousCrossParentSibling(previousCrossParentSibling: IInlineLayoutNodeSibling | null) {
        this.internalPreviousCrossParentSibling = previousCrossParentSibling;
    }

    setNextCrossParentSibling(nextCrossParentSibling: IInlineLayoutNodeSibling | null) {
        this.internalNextCrossParentSibling = nextCrossParentSibling;
    }

    setPreviousContentSibling(previousContentSibling: IInlineLayoutNodeContentSibling | null) {
        this.internalPreviousContentSibling = previousContentSibling;
    }

    setNextContentSibling(nextContentSibling: IInlineLayoutNodeContentSibling | null) {
        this.internalNextContentSibling = nextContentSibling;
    }

    setPreviousCrossParentContentSibling(previousCrossParentContentSibling: IInlineLayoutNodeContentSibling | null) {
        this.internalPreviousCrossParentContentSibling = previousCrossParentContentSibling;
    }

    setNextCrossParentContentSibling(nextCrossParentContentSibling: IInlineLayoutNodeContentSibling | null) {
        this.internalNextCrossParentContentSibling = nextCrossParentContentSibling;
    }

    convertCoordinatesToPosition(x: number, y: number) {
        return x < this.layout.width / 2 ? 0 : 1;
    }

    resolveBoundingBoxes(from: number, to: number): IResolveBoundingBoxesResult {
        if (from < 0 || to > this.size || from > to) {
            throw new Error('Invalid range.');
        }
        return {
            node: this,
            boundingBoxes: [
                {
                    from,
                    to,
                    width: from === to ? 0 : this.layout.width,
                    height: this.layout.height,
                    left: from === 0 ? 0 : this.layout.width,
                    right: to === 1 ? 0 : this.layout.width,
                    top: 0,
                    bottom: 0,
                },
            ],
            children: [],
        };
    }

    describePosition(position: number): ILayoutPositionLayerDescription[] {
        if (position < 0 || position >= this.size) {
            throw new Error('Invalid position.');
        }
        return [{ node: this, position }];
    }

    protected buildLayout() {
        return {
            width: this.layoutProps.width,
            height: this.layoutProps.height,
        };
    }
}
