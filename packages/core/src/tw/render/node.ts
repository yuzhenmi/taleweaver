import { INode, Node } from '../tree/node';
import { NodeList } from '../tree/node-list';
import { generateId } from '../util/id';
import { IResolvedPosition } from './position';
import { IPosition } from '../model/position';

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
    resolvePosition(position: IPosition): IResolvedPosition;
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
        super(generateId());
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

    resolvePosition(position: IPosition): IResolvedPosition {
        const offset = this.boundOffset(position[0]);
        const resolvedPosition: IResolvedPosition = [];
        if (this.leaf) {
            resolvedPosition.push({ node: this, offset });
        } else {
            let cumulatedOffset = 0;
            for (let n = 0, nn = this.children.length; n < nn; n++) {
                const child = this.children.at(n);
                if (child.modelId) {
                    if (cumulatedOffset === position[0]) {
                        resolvedPosition.push({ node: this, offset: n }, ...child.resolvePosition(position.slice(1)));
                    }
                    cumulatedOffset++;
                }
            }
        }
        return resolvedPosition;
    }
}
