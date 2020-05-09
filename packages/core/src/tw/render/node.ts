import { IModelNode } from '../model/node';
import { INode, Node } from '../tree/node';
import { IPosition, Position } from '../tree/position';

export type IRenderNodeType = 'doc' | 'block' | 'inline' | 'text' | 'word' | 'atom';

export interface IRenderNode<TStyle> extends INode<IRenderNode<any>> {
    readonly type: IRenderNodeType;
    readonly componentId: string;
    readonly partId: string | null;
    readonly modelId: string | null;
    readonly text: string;
    readonly size: number;
    readonly modelSize: number;
    readonly needLayout: boolean;
    readonly style: TStyle;

    clearNeedLayout(): void;
    resolvePosition(offset: number): IRenderPosition;
    convertOffsetToModelOffset(offset: number): number;
    convertModelOffsetToOffset(modelOffset: number): number;
    updateFromModel(modelNode: IModelNode<any>): void;
}

export interface IRenderPosition extends IPosition<IRenderNode<any>> {}

export abstract class RenderNode<TStyle> extends Node<IRenderNode<TStyle>> implements IRenderNode<TStyle> {
    protected abstract get padModelSize(): boolean;
    protected abstract get modelTextSize(): number;

    abstract get type(): IRenderNodeType;
    abstract get partId(): string | null;

    protected internalText: string;
    protected internalSize?: number;
    protected internalChildrenModelSize?: number;
    protected internalNeedLayout = true;

    constructor(
        readonly componentId: string,
        readonly modelId: string | null,
        id: string,
        readonly style: TStyle,
        text: string,
    ) {
        super(id);
        this.internalText = text;
        this.onDidUpdateNode(() => {
            this.internalSize = undefined;
            this.internalChildrenModelSize = undefined;
            this.internalNeedLayout = true;
        });
    }

    get text() {
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
        return this.internalChildrenModelSize! + padding + this.modelTextSize;
    }

    get needLayout() {
        return this.internalNeedLayout;
    }

    apply(node: this) {
        this.internalText = node.text;
        super.apply(node);
    }

    clearNeedLayout() {
        this.internalNeedLayout = false;
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

    updateFromModel(modelNode: IModelNode<any>) {
        this.internalText = modelNode.text;
        this.didUpdateNodeEventEmitter.emit({});
    }
}

export class RenderPosition extends Position<IRenderNode<any>> implements IRenderPosition {}
