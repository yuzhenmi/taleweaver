import { BaseLayoutNode, LayoutPositionLayerDescription, ResolveBoundingBoxesResult } from './base';
import { TextLayoutNode } from './text';
import { WordLayoutNode } from './word';

export interface InlineLayoutProps {
    readonly width: number;
    readonly height: number;
}

export interface InlineLayout {
    readonly width: number;
    readonly height: number;
}

export type InlineLayoutNodeSibling = InlineLayoutNode | TextLayoutNode;
export type InlineLayoutNodeContentSibling = InlineLayoutNode | WordLayoutNode;

export class InlineLayoutNode extends BaseLayoutNode<InlineLayoutProps, InlineLayout> {
    readonly type = 'inline';
    protected internalPreviousSibling: InlineLayoutNodeSibling | null = null;
    protected internalNextSibling: InlineLayoutNodeSibling | null = null;
    protected internalPreviousCrossParentSibling: InlineLayoutNodeSibling | null = null;
    protected internalNextCrossParentSibling: InlineLayoutNodeSibling | null = null;
    protected internalPreviousContentSibling: InlineLayoutNodeContentSibling | null = null;
    protected internalNextContentSibling: InlineLayoutNodeContentSibling | null = null;
    protected internalPreviousCrossParentContentSibling: InlineLayoutNodeContentSibling | null = null;
    protected internalNextCrossParentContentSibling: InlineLayoutNodeContentSibling | null = null;
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

    setPreviousSibling(previousSibling: InlineLayoutNodeSibling | null) {
        this.internalPreviousSibling = previousSibling;
    }

    setNextSibling(nextSibling: InlineLayoutNodeSibling | null) {
        this.internalNextSibling = nextSibling;
    }

    setPreviousCrossParentSibling(previousCrossParentSibling: InlineLayoutNodeSibling | null) {
        this.internalPreviousCrossParentSibling = previousCrossParentSibling;
    }

    setNextCrossParentSibling(nextCrossParentSibling: InlineLayoutNodeSibling | null) {
        this.internalNextCrossParentSibling = nextCrossParentSibling;
    }

    setPreviousContentSibling(previousContentSibling: InlineLayoutNodeContentSibling | null) {
        this.internalPreviousContentSibling = previousContentSibling;
    }

    setNextContentSibling(nextContentSibling: InlineLayoutNodeContentSibling | null) {
        this.internalNextContentSibling = nextContentSibling;
    }

    setPreviousCrossParentContentSibling(previousCrossParentContentSibling: InlineLayoutNodeContentSibling | null) {
        this.internalPreviousCrossParentContentSibling = previousCrossParentContentSibling;
    }

    setNextCrossParentContentSibling(nextCrossParentContentSibling: InlineLayoutNodeContentSibling | null) {
        this.internalNextCrossParentContentSibling = nextCrossParentContentSibling;
    }

    convertCoordinatesToPosition(x: number, y: number) {
        return x < this.layout.width / 2 ? 0 : 1;
    }

    resolveBoundingBoxes(from: number, to: number): ResolveBoundingBoxesResult {
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

    describePosition(position: number): LayoutPositionLayerDescription[] {
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
