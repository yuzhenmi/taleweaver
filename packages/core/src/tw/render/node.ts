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
    getPartId(): string | undefined;
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
    abstract clearCache(): void;
    abstract convertOffsetToModelOffset(offset: number): number;

    constructor(protected component: IComponent, protected id: string) {
        super();
    }

    getComponentId() {
        return this.component.getId();
    }

    getPartId() {
        return undefined;
    }

    appendChild(child: TChild) {
        super.appendChild(child);
        this.clearCache();
    }

    insertBefore(child: TChild, before: TChild) {
        super.insertBefore(child, before);
        this.clearCache();
    }

    removeChild(child: TChild) {
        super.removeChild(child);
        this.clearCache();
    }

    getId() {
        return this.id;
    }

    onUpdated(updatedNode: this) {
        super.onUpdated(updatedNode);
        this.clearCache();
    }
}
