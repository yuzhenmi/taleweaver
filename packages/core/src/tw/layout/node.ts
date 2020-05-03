import { INode, Node } from '../tree/node';
import { IPosition, Position } from '../tree/position';

export type ILayoutNodeType = 'doc' | 'page' | 'block' | 'line' | 'inline' | 'text' | 'atom';

export interface ILayoutPosition extends IPosition<ILayoutNode> {}

export interface ILayoutNode extends INode<ILayoutNode> {
    readonly type: ILayoutNodeType;
    readonly componentId: string;
    readonly partId: string | null;
    readonly size: number;
    readonly width: number;
    readonly height: number;
    readonly innerWidth: number;
    readonly innerHeight: number;
    readonly paddingTop: number;
    readonly paddingBottom: number;
    readonly paddingLeft: number;
    readonly paddingRight: number;
    readonly verticalPaddng: number;
    readonly horizontalPadding: number;
    resolvePosition(offset: number, depth?: number): ILayoutPosition;
}

export class LayoutPosition extends Position<ILayoutNode> implements ILayoutPosition {}

export abstract class LayoutNode extends Node<ILayoutNode> implements ILayoutNode {
    abstract get type(): ILayoutNodeType;
    abstract get partId(): string | null;
    abstract get width(): number;
    abstract get height(): number;
    abstract get paddingTop(): number;
    abstract get paddingBottom(): number;
    abstract get paddingLeft(): number;
    abstract get paddingRight(): number;

    protected internalSize?: number;

    constructor(readonly componentId: string, id: string, children: ILayoutNode[], text: string) {
        super(id, children, text);
        this.onDidUpdateNode(() => {
            this.internalSize = undefined;
        });
    }

    get size() {
        if (this.internalSize === undefined) {
            if (this.leaf) {
                this.internalSize = this.text.length;
            }
            this.internalSize = this.children.reduce((size, child) => size + child.size, 0);
        }
        return this.internalSize;
    }

    get innerWidth() {
        return this.width - this.horizontalPadding;
    }

    get innerHeight() {
        return this.height - this.verticalPaddng;
    }

    get verticalPaddng() {
        return this.paddingTop + this.paddingBottom;
    }

    get horizontalPadding() {
        return this.paddingLeft + this.paddingRight;
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
