import { IModelPosition } from '../model/position';
import { INode, Node } from '../tree/node';
import { NodeList } from '../tree/node-list';
import { generateId } from '../util/id';
import { IRenderPosition, IResolvedRenderPosition } from './position';

export type IRenderNodeType = 'doc' | 'block' | 'text' | 'word' | 'atom';

export interface IRenderNode<TStyle, TAttributes> extends INode<IRenderNode<TStyle, TAttributes>> {
    readonly type: IRenderNodeType;
    readonly componentId: string;
    readonly partId: string | null;
    readonly modelId: string | null;
    readonly text: string;
    readonly style: TStyle;
    readonly size: number;
    readonly needLayout: boolean;

    clearNeedLayout(): void;
    resolvePosition(position: IRenderPosition): IResolvedRenderPosition;
    convertModelToRenderPosition(modelPosition: IModelPosition): IRenderPosition;
    convertRenderToModelPosition(renderPosition: IRenderPosition): IModelPosition;
}

export abstract class RenderNode<TStyle, TAttributes> extends Node<IRenderNode<TStyle, TAttributes>>
    implements IRenderNode<TStyle, TAttributes> {
    abstract get type(): IRenderNodeType;
    abstract get partId(): string | null;
    abstract get style(): TStyle;

    protected internalSize?: number;
    protected internalChildrenModelSize?: number;
    protected internalNeedLayout = true;

    constructor(
        readonly componentId: string,
        readonly modelId: string | null,
        readonly text: string,
        protected readonly attributes: TAttributes,
        children: IRenderNode<any, any>[],
    ) {
        super(modelId || generateId());
        this.internalChildren = new NodeList(children);
        children.forEach((child) => {
            child.parent = this;
        });
    }

    get contentLength() {
        if (this.leaf) {
            return this.text.length;
        }
        return this.children.length;
    }

    get size() {
        if (this.internalSize === undefined) {
            if (this.leaf) {
                this.internalSize = this.contentLength;
            } else {
                this.internalSize = this.children.reduce((size, child) => size + child.size, 0);
            }
        }
        return this.internalSize;
    }

    get needLayout() {
        return this.internalNeedLayout;
    }

    clearNeedLayout() {
        this.internalNeedLayout = false;
    }

    resolvePosition(position: IRenderPosition): IResolvedRenderPosition {
        if (position < 0 || position >= this.size) {
            throw new Error(`Offset ${position} is out of range.`);
        }
        if (this.leaf) {
            return [{ node: this, offset: position, position }];
        }
        let cumulatedSize = 0;
        for (let n = 0, nn = this.children.length; n < nn; n++) {
            const child = this.children.at(n);
            const childSize = child.size;
            if (cumulatedSize + childSize > position) {
                return [
                    { node: this, offset: n, position: cumulatedSize },
                    ...child.resolvePosition(position - cumulatedSize),
                ];
            }
            cumulatedSize += childSize;
        }
        throw new Error('Offset cannot be resolved.');
    }

    convertModelToRenderPosition(modelPosition: IModelPosition): IRenderPosition {
        const modelOffset = this.boundOffset(modelPosition[0]);
        if (this.leaf) {
            return modelOffset;
        }
        let offset = 0;
        let cumulatedSize = 0;
        for (let n = 0, nn = this.children.length; n < nn; n++) {
            const child = this.children.at(n);
            if (child.modelId) {
                if (offset === modelOffset) {
                    return cumulatedSize + child.convertModelToRenderPosition(modelPosition.slice(1));
                }
                offset++;
            }
            cumulatedSize += child.size;
        }
        throw new Error(`Model offset ${modelOffset} is out of range.`);
    }

    convertRenderToModelPosition(renderPosition: IRenderPosition): IModelPosition {
        if (renderPosition < 0 || renderPosition > this.size) {
            throw new Error('Render position is out of range.');
        }
        if (this.leaf) {
            return [this.boundOffset(renderPosition)];
        }
        let cumulatedSize = 0;
        let modelOffset = 0;
        for (let n = 0, nn = this.children.length; n < nn; n++) {
            const child = this.children.at(n);
            const childSize = child.size;
            if (child.modelId) {
                let nextNonModelSize = 0;
                for (let m = n + 1; m < nn; m++) {
                    const nextChild = this.children.at(m);
                    if (nextChild.modelId) {
                        break;
                    }
                    nextNonModelSize += nextChild.size;
                }
                if (cumulatedSize + childSize + nextNonModelSize > renderPosition) {
                    return [modelOffset, ...child.convertRenderToModelPosition(renderPosition - cumulatedSize)];
                }
                modelOffset++;
            }
            cumulatedSize += childSize;
        }
        throw new Error(`Render offset ${renderPosition} is out of range.`);
    }
}
