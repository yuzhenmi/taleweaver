import { INode, Node } from '../tree/node';
import { IPosition, Position } from '../tree/position';
import { generateId } from '../util/id';

export type IRenderNodeType = 'doc' | 'block' | 'text' | 'word' | 'atom';

export interface IRenderNode<TStyle, TAttributes> extends INode<IRenderNode<TStyle, TAttributes>> {
    readonly type: IRenderNodeType;
    readonly componentId: string;
    readonly partId: string | null;
    readonly modelId: string | null;
    readonly text: string;
    readonly style: TStyle;
    readonly size: number;
    readonly modelSize: number;
    readonly needLayout: boolean;

    clearNeedLayout(): void;
    resolvePosition(offset: number): IRenderPosition;
    convertOffsetToModelOffset(offset: number): number;
    convertModelOffsetToOffset(modelOffset: number): number;
    update(text: string, attributes: TAttributes): void;
}

export interface IRenderPosition extends IPosition<IRenderNode<any, any>> {}

export abstract class RenderNode<TStyle, TAttributes> extends Node<IRenderNode<TStyle, TAttributes>>
    implements IRenderNode<TStyle, TAttributes> {
    protected abstract get padModelSize(): boolean;

    abstract get type(): IRenderNodeType;
    abstract get partId(): string | null;
    abstract get style(): TStyle;

    protected internalText?: string;
    protected internalAttributes?: TAttributes;
    protected internalSize?: number;
    protected internalChildrenModelSize?: number;
    protected internalNeedLayout = true;

    constructor(readonly componentId: string, readonly modelId: string | null) {
        super(generateId());
        this.onDidUpdateNode(() => {
            this.internalSize = undefined;
            this.internalChildrenModelSize = undefined;
            this.internalNeedLayout = true;
        });
    }

    get text() {
        if (this.internalText === undefined) {
            throw new Error('Render node text is not initialized.');
        }
        return this.internalText;
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

    get modelSize() {
        if (this.internalChildrenModelSize === undefined) {
            this.internalChildrenModelSize = this.children.reduce((size, childNode) => size + childNode.modelSize, 2);
        }
        const padding = this.padModelSize ? 2 : 0;
        return this.internalChildrenModelSize! + padding + this.text.length;
    }

    get needLayout() {
        return this.internalNeedLayout;
    }

    protected get attributes() {
        if (this.internalAttributes === undefined) {
            throw new Error('Render node attributes is not initialized.');
        }
        return this.internalAttributes;
    }

    clearNeedLayout() {
        this.internalNeedLayout = false;
    }

    resolvePosition(offset: number): IRenderPosition {
        if (offset < 0 || offset >= this.size) {
            throw new Error(`Offset ${offset} is out of range.`);
        }
        const layers: Array<{
            node: IRenderNode<any, any>;
            offset: number;
        }> = [{ node: this, offset }];
        {
            let node: IRenderNode<any, any> = this;
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
            let node: IRenderNode<any, any> | null = this;
            while (node && !node.leaf) {
                const lastLayer = layers[layers.length - 1];
                let cumulatedOffset = 0;
                let child: IRenderNode<any, any> | null = null;
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

    update(text: string, attributes: any) {
        this.internalAttributes = attributes;
        this.internalText = text;
        this.didUpdateNodeEventEmitter.emit({});
    }
}

export class RenderPosition extends Position<IRenderNode<any, any>> implements IRenderPosition {}
