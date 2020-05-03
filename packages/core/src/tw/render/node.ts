import { INode, Node } from '../tree/node';
import { IPosition, Position } from '../tree/position';

export type IRenderNodeType = 'doc' | 'block' | 'inline' | 'text' | 'word' | 'atom';

export interface IStyle {
    [key: string]: any;
}

export interface IRenderNode<TStyle extends IStyle> extends INode<IRenderNode<any>> {
    readonly type: IRenderNodeType;
    readonly componentId: string;
    readonly partId: string | null;
    readonly size: number;
    readonly modelSize: number;
    readonly style: TStyle;

    resolvePosition(offset: number): IRenderPosition;
    convertOffsetToModelOffset(offset: number): number;
    convertModelOffsetToOffset(modelOffset: number): number;
}

export interface IRenderPosition extends IPosition<IRenderNode<any>> {}

export abstract class RenderNode<TStyle extends IStyle> extends Node<IRenderNode<TStyle>>
    implements IRenderNode<TStyle> {
    protected abstract get padModelSize(): boolean;
    protected abstract get modelTextSize(): number;

    abstract get type(): IRenderNodeType;
    abstract get partId(): string | null;

    protected cachedSize?: number;
    protected cachedChildrenSize?: number;
    protected internalText: string;

    constructor(readonly componentId: string, id: string, readonly style: TStyle, text: string) {
        super(id);
        this.internalText = text;
        this.onDidUpdateNode(() => {
            this.cachedSize = undefined;
        });
    }

    get text() {
        return this.internalText;
    }

    get size() {
        if (this.cachedSize === undefined) {
            if (this.leaf) {
                this.cachedSize = this.text.length;
            }
            this.cachedSize = this.children.reduce((size, child) => size + child.size, 0);
        }
        return this.cachedSize;
    }

    get modelSize() {
        if (this.cachedChildrenSize === undefined) {
            this.cachedChildrenSize = this.children.reduce((size, childNode) => size + childNode.modelSize, 2);
        }
        const padding = this.padModelSize ? 2 : 0;
        return this.cachedChildrenSize! + padding + this.modelTextSize;
    }

    resolvePosition(offset: number): IRenderPosition {
        if (offset < 0 || offset >= this.size) {
            throw new Error(`Offset ${offset} is out of range.`);
        }
        const layers: Array<{
            node: IRenderNode<any>;
            offset: number;
        }> = [{ node: this, offset }];
        {
            let node: IRenderNode<any> = this;
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
            let node: IRenderNode<any> | null = this;
            while (node && !node.leaf) {
                const lastLayer = layers[layers.length - 1];
                let cumulatedOffset = 0;
                let child: IRenderNode<any> | null = null;
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
        const buildPosition = (parent: IRenderPosition | null, depth: number): IRenderPosition => {
            const { node, offset } = layers[depth];
            return new RenderPosition(node, depth, offset, parent, (parent) =>
                depth < layers.length ? buildPosition(parent, depth + 1) : null,
            );
        };
        return buildPosition(null, 0);
    }

    convertOffsetToModelOffset(offset: number): number {
        let cumulatedSize = 0;
        let cumulatedModelSize = this.padModelSize ? 1 : 0;
        for (let n = 0, nn = this.children.length; n < nn; n++) {
            const child = this.children.at(n);
            const childSize = child.size;
            if (cumulatedSize + childSize > offset) {
                return cumulatedModelSize + child.convertOffsetToModelOffset(offset - cumulatedSize);
            }
            cumulatedSize += childSize;
            cumulatedModelSize += child.modelSize;
        }
        throw new Error(`Offset ${offset} is out of range.`);
    }

    convertModelOffsetToOffset(modelOffset: number): number {
        let cumulatedModelSize = this.padModelSize ? 1 : 0;
        let cumulatedSize = 0;
        for (let n = 0, nn = this.children.length; n < nn; n++) {
            const child = this.children.at(n);
            const childModelSize = child.modelSize;
            if (cumulatedModelSize + childModelSize > modelOffset) {
                return cumulatedSize + child.convertModelOffsetToOffset(modelOffset - cumulatedModelSize);
            }
            cumulatedModelSize += childModelSize;
            cumulatedSize += child.size;
        }
        throw new Error(`Model offset ${modelOffset} is out of range.`);
    }
}

export class RenderPosition extends Position<IRenderNode<any>> implements IRenderPosition {}
