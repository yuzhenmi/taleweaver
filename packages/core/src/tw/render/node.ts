import { INode, Node } from '../tree/node';
import { NodeList } from '../tree/node-list';
import { IPosition, IPositionDepth, Position } from '../tree/position';
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
}

export interface IRenderPosition extends IPosition<IRenderNode<any, any>> {}
export interface IRenderPositionDepth extends IPositionDepth<IRenderNode<any, any>> {}

export abstract class RenderNode<TStyle, TAttributes> extends Node<IRenderNode<TStyle, TAttributes>>
    implements IRenderNode<TStyle, TAttributes> {
    protected abstract get padModelSize(): boolean;

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

    clearNeedLayout() {
        this.internalNeedLayout = false;
    }

    resolvePosition(offset: number): IRenderPosition {
        if (offset < 0 || offset >= this.size) {
            throw new Error(`Offset ${offset} is out of range.`);
        }
        if (this.leaf) {
            return new RenderPosition([{ node: this, offset, index: offset }]);
        }
        let cumulatedOffset = 0;
        for (let n = 0, nn = this.children.length; n < nn; n++) {
            const child = this.children.at(n);
            const childSize = child.size;
            if (cumulatedOffset + childSize > offset) {
                const childPosition = child.resolvePosition(offset - cumulatedOffset);
                const depths: IRenderPositionDepth[] = [{ node: this, offset, index: n }];
                for (let m = 0; m < childPosition.depth; m++) {
                    depths.push(childPosition.atDepth(m));
                }
                return new RenderPosition(depths);
            }
            cumulatedOffset += childSize;
        }
        throw new Error('Offset cannot be resolved.');
    }

    convertOffsetToModelOffset(offset: number): number {
        if (offset < 0 || offset >= this.size) {
            throw new Error('Offset is out of range.');
        }
        if (this.leaf) {
            return offset + 1;
        }
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
        if (modelOffset < 0 || modelOffset >= this.modelSize) {
            throw new Error('Model offset is out of range.');
        }
        if (this.leaf) {
            return modelOffset - 1;
        }
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
        return this.size;
    }
}

export class RenderPosition extends Position<IRenderNode<any, any>> implements IRenderPosition {}
