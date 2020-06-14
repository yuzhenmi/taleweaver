import { INode, Node } from '../tree/node';
import { NodeList } from '../tree/node-list';
import { IPosition, IPositionDepth, Position } from '../tree/position';
import { generateId } from '../util/id';

export type ILayoutNodeType = 'doc' | 'page' | 'block' | 'line' | 'text' | 'word' | 'atom';

export interface ILayoutPosition extends IPosition<ILayoutNode> {
    atLineDepth(): ILayoutPositionDepth;
}
export interface ILayoutPositionDepth extends IPositionDepth<ILayoutNode> {}

export interface IBoundingBox {
    from: number;
    to: number;
    width: number;
    height: number;
    left: number;
    right: number;
    top: number;
    bottom: number;
}

export interface IResolveBoundingBoxesResult {
    node: ILayoutNode;
    boundingBoxes: IBoundingBox[];
    children: IResolveBoundingBoxesResult[];
}

export interface ILayoutNode extends INode<ILayoutNode> {
    readonly type: ILayoutNodeType;
    readonly renderId: string | null;
    readonly text: string;
    readonly size: number;
    readonly width: number;
    readonly height: number;
    readonly paddingTop: number;
    readonly paddingBottom: number;
    readonly paddingLeft: number;
    readonly paddingRight: number;
    readonly paddingVertical: number;
    readonly paddingHorizontal: number;
    readonly innerWidth: number;
    readonly innerHeight: number;
    readonly needView: boolean;

    clearNeedView(): void;
    resolvePosition(offset: number, depth?: number): ILayoutPosition;
    convertCoordinatesToOffset(x: number, y: number): number;
    resolveBoundingBoxes(from: number, to: number): IResolveBoundingBoxesResult;
}

export abstract class LayoutNode extends Node<ILayoutNode> implements ILayoutNode {
    abstract get type(): ILayoutNodeType;
    abstract get width(): number;
    abstract get height(): number;

    abstract resolveBoundingBoxes(from: number, to: number): IResolveBoundingBoxesResult;
    abstract convertCoordinatesToOffset(x: number, y: number): number;

    protected internalSize?: number;
    protected internalNeedView = true;

    constructor(
        readonly renderId: string | null,
        readonly text: string,
        children: ILayoutNode[],
        readonly paddingTop: number,
        readonly paddingBottom: number,
        readonly paddingLeft: number,
        readonly paddingRight: number,
    ) {
        super(generateId());
        this.internalChildren = new NodeList(children);
        children.forEach((child) => {
            child.parent = this;
        });
    }

    get size() {
        if (this.internalSize === undefined) {
            if (this.leaf) {
                this.internalSize = this.text.length;
            } else {
                this.internalSize = this.children.reduce((size, child) => size + child.size, 0);
            }
        }
        return this.internalSize;
    }

    get paddingVertical() {
        return this.paddingTop + this.paddingBottom;
    }

    get paddingHorizontal() {
        return this.paddingLeft + this.paddingRight;
    }

    get innerWidth() {
        return this.width - this.paddingHorizontal;
    }

    get innerHeight() {
        return this.height - this.paddingVertical;
    }

    get needView() {
        return this.internalNeedView;
    }

    clearNeedView() {
        this.internalNeedView = false;
    }

    resolvePosition(offset: number): ILayoutPosition {
        if (offset < 0 || offset >= this.size) {
            throw new Error(`Offset ${offset} is out of range.`);
        }
        if (offset === 0) {
            return new LayoutPosition([{ node: this, offset, index: -1 }]);
        }
        if (this.leaf) {
            return new LayoutPosition([{ node: this, offset, index: offset }]);
        }
        let cumulatedOffset = 0;
        for (let n = 0, nn = this.children.length; n < nn; n++) {
            const child = this.children.at(n);
            const childSize = child.size;
            if (cumulatedOffset + childSize > offset) {
                const childPosition = child.resolvePosition(offset - cumulatedOffset);
                const depths: ILayoutPositionDepth[] = [{ node: this, offset, index: n }];
                for (let m = 0; m < childPosition.depth; m++) {
                    depths.push(childPosition.atDepth(m));
                }
                return new LayoutPosition(depths);
            }
            cumulatedOffset += childSize;
        }
        throw new Error('Offset cannot be resolved.');
    }
}

export class LayoutPosition extends Position<ILayoutNode> implements ILayoutPosition {
    atLineDepth() {
        for (let n = this.depth - 1; n >= 0; n--) {
            const depth = this.atDepth(n);
            if (depth.node.type === 'line') {
                return depth;
            }
        }
        throw new Error('Line depth not found.');
    }
}
