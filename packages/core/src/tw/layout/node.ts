import { INode, Node } from '../tree/node';
import { IPosition, Position } from '../tree/position';
import { generateId } from '../util/id';

export type ILayoutNodeType = 'doc' | 'page' | 'block' | 'line' | 'text' | 'word' | 'atom';

export interface ILayoutPosition extends IPosition<ILayoutNode> {}

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

export class LayoutPosition extends Position<ILayoutNode> implements ILayoutPosition {}

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
        readonly paddingTop: number,
        readonly paddingBottom: number,
        readonly paddingLeft: number,
        readonly paddingRight: number,
    ) {
        super(generateId());
        this.onDidUpdateNode(() => {
            this.internalNeedView = true;
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
        const layers: Array<{
            node: ILayoutNode;
            offset: number;
        }> = [{ node: this, offset }];
        {
            let node: ILayoutNode = this;
            let parent = this.parent;
            while (parent) {
                let parentOffset = 0;
                let previousSibling = node.previousSibling;
                while (previousSibling) {
                    parentOffset += previousSibling.size;
                    previousSibling = node.previousSibling;
                }
                layers.unshift({ node: parent, offset: parentOffset + layers[0].offset });
                node = parent;
                parent = node.parent;
            }
        }
        {
            let node: ILayoutNode | null = this;
            while (node && !node.leaf) {
                const lastLayer = layers[layers.length - 1];
                let cumulatedOffset = 0;
                let child: ILayoutNode | null = null;
                for (let n = 0, nn = node.children.length; n < nn; n++) {
                    child = node.children.at(n);
                    const childSize = child.size;
                    if (cumulatedOffset + childSize > lastLayer.offset) {
                        layers.push({ node: child, offset: lastLayer.offset - cumulatedOffset });
                        break;
                    }
                    cumulatedOffset += childSize;
                    node = child;
                }
            }
        }
        const buildPosition = (parent: ILayoutPosition | null, depth: number): ILayoutPosition => {
            const { node, offset } = layers[depth];
            return new LayoutPosition(node, depth, offset, parent, (parent) =>
                depth < layers.length ? buildPosition(parent, depth + 1) : null,
            );
        };
        return buildPosition(null, 0);
    }
}
