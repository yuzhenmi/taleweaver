import { IRenderNode } from '../render/node';
import { INode, Node } from '../tree/node';
import { IPosition, Position } from '../tree/position';
import { generateId } from '../util/id';

export type ILayoutNodeType = 'doc' | 'page' | 'block' | 'line' | 'inline' | 'text' | 'atom';

export interface ILayoutPosition extends IPosition<ILayoutNode> {}

export interface IRenderRange {
    from: number;
    to: number;
}

export interface IBox {
    width: number;
    height: number;
    paddingTop: number;
    paddingBottom: number;
    paddingLeft: number;
    paddingRight: number;
}

export interface ILayoutNode extends INode<ILayoutNode> {
    readonly type: ILayoutNodeType;
    readonly renderRange: IRenderRange;
    readonly size: number;
    readonly width: number;
    readonly height: number;
    readonly innerWidth: number;
    readonly innerHeight: number;
    readonly paddingTop: number;
    readonly paddingBottom: number;
    readonly paddingLeft: number;
    readonly paddingRight: number;
    readonly needView: boolean;

    resolvePosition(offset: number, depth?: number): ILayoutPosition;
}

export class LayoutPosition extends Position<ILayoutNode> implements ILayoutPosition {}

export abstract class LayoutNode extends Node<ILayoutNode> implements ILayoutNode {
    abstract get type(): ILayoutNodeType;

    protected internalRenderNode?: IRenderNode<any>;
    protected internalRenderRange?: IRenderRange;
    protected internalBox?: IBox;
    protected internalNeedView = true;

    constructor(readonly renderId: string) {
        super(generateId());
        this.onDidUpdateNode(() => {
            this.internalNeedView = true;
        });
    }

    get renderNode() {
        if (this.internalRenderNode === undefined) {
            throw new Error('Layout node render node is not initialized.');
        }
        return this.internalRenderNode;
    }

    get renderRange() {
        if (this.internalRenderRange === undefined) {
            throw new Error('Layout node render range is not initialized.');
        }
        return this.internalRenderRange;
    }

    get size() {
        return this.renderRange.to - this.renderRange.from;
    }

    get width() {
        return this.box.width;
    }

    get height() {
        return this.box.height;
    }

    get paddingTop() {
        return this.box.paddingTop;
    }

    get paddingBottom() {
        return this.box.paddingBottom;
    }

    get paddingLeft() {
        return this.box.paddingLeft;
    }

    get paddingRight() {
        return this.box.paddingRight;
    }

    get innerWidth() {
        return this.box.width - this.horizontalPadding;
    }

    get innerHeight() {
        return this.box.height - this.verticalPaddng;
    }

    get verticalPaddng() {
        return this.paddingTop + this.paddingBottom;
    }

    get horizontalPadding() {
        return this.paddingLeft + this.paddingRight;
    }

    get needView() {
        return this.internalNeedView;
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

    update(renderNode: IRenderNode<any>, renderRange: IRenderRange, box: IBox) {
        this.internalRenderNode = renderNode;
        this.internalRenderRange = renderRange;
        this.internalBox = box;
        this.didUpdateNodeEventEmitter.emit({});
    }

    protected get box() {
        if (this.internalBox === undefined) {
            throw new Error('Layout node box is not initialized.');
        }
        return this.internalBox;
    }
}
