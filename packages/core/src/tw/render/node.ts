import { INode, Node } from '../tree/node';
import { NodeList } from '../tree/node-list';
import { IPosition, IResolvedOffset, IResolvedPosition } from '../tree/position';
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
    readonly needLayout: boolean;

    clearNeedLayout(): void;
    resolvePosition(position: IPosition): IResolvedRenderPosition;
}

export type IResolvedRenderOffset = IResolvedOffset<IRenderNode<any, any>>;
export type IResolvedRenderPosition = IResolvedPosition<IRenderNode<any, any>>;

export abstract class RenderNode<TStyle, TAttributes> extends Node<IRenderNode<TStyle, TAttributes>>
    implements IRenderNode<TStyle, TAttributes> {
    protected abstract get pseudo(): boolean;

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
        readonly contentLength: number,
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

    resolvePosition(position: IPosition): IResolvedRenderPosition {
        if (position.length === 0) {
            position = [0];
        }
        const offset = this.boundOffset(position[0]);
        const resolvedPosition: IResolvedRenderPosition = [{ node: this, offset }];
        if (!this.leaf) {
            const child = this.children.at(offset);
            resolvedPosition.push(...child.resolvePosition(position.slice(1)));
        }
        return resolvedPosition;
    }
}
