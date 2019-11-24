import { IComponent } from 'tw/component/component';
import { INode, Node } from 'tw/tree/node';
import { IPosition, Position } from 'tw/tree/position';

export interface IRenderPosition extends IPosition<IRenderNode> {}

export class RenderPosition extends Position<IRenderNode> {}

export interface IRenderNode<
    TParent extends IRenderNode = IRenderNode<any, any>,
    TChild extends IRenderNode = IRenderNode<any, any>
> extends INode<TParent, TChild> {
    getComponentId(): string;
    getSize(): number;
    getModelSize(): number;
    resolvePosition(offset: number, depth?: number): IRenderPosition;
    clearCache(): void;
    convertOffsetToModelOffset(offset: number): number;
}

export abstract class RenderNode<TParent extends IRenderNode, TChild extends IRenderNode> extends Node<TParent, TChild>
    implements IRenderNode<TParent, TChild> {
    abstract getSize(): number;
    abstract getModelSize(): number;
    abstract resolvePosition(offset: number, depth?: number): IRenderPosition;
    abstract convertOffsetToModelOffset(offset: number): number;

    constructor(protected component: IComponent, protected id: string) {
        super();
    }

    getComponentId() {
        return this.component.getId();
    }

    getId() {
        return this.id;
    }

    clearCache() {
        if (!this.isRoot()) {
            this.getParent()!.clearCache();
        }
    }
}
