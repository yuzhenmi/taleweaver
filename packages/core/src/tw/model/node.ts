import { IComponent } from 'tw/component/component';
import { IAttributes, IToken } from 'tw/state/token';
import { INode, Node } from 'tw/tree/node';
import { IPosition, Position } from 'tw/tree/position';

export interface IModelPosition extends IPosition<IModelNode> {}

export class ModelPosition extends Position<IModelNode> {}

export interface IModelNode<
    TAttributes extends IAttributes = any,
    TParent extends IModelNode = IModelNode<any, any, any>,
    TChild extends IModelNode = IModelNode<any, any, any>
> extends INode<TParent, TChild> {
    getComponentId(): string;
    getPartId(): string | undefined;
    getAttributes(): TAttributes;
    getSize(): number;
    resolvePosition(offset: number, depth?: number): IModelPosition;
    clearCache(): void;
    toTokens(): IToken[];
    toDOM(from: number, to: number): HTMLElement;
    clone(): ModelNode<TAttributes, TParent, TChild>;
}

export abstract class ModelNode<TAttributes, TParent extends IModelNode, TChild extends IModelNode>
    extends Node<TParent, TChild>
    implements IModelNode<TAttributes, TParent, TChild> {
    abstract getSize(): number;
    abstract resolvePosition(offset: number, depth?: number): IModelPosition;
    abstract toDOM(from: number, to: number): HTMLElement;
    abstract toTokens(): IToken[];
    abstract clone(): ModelNode<TAttributes, TParent, TChild>;

    constructor(protected component: IComponent, protected id: string, protected attributes: TAttributes) {
        super();
    }

    getComponentId() {
        return this.component.getId();
    }

    getPartId() {
        return undefined;
    }

    getId() {
        return this.id;
    }

    getAttributes() {
        return this.attributes;
    }

    clearCache() {
        if (!this.isRoot()) {
            this.getParent()!.clearCache();
        }
    }
}
