import { IComponent } from 'tw/component/component';
import { IToken } from 'tw/state/token';
import { INode, Node } from 'tw/tree/node';
import { IPosition, Position } from 'tw/tree/position';

export interface IModelPosition extends IPosition<IModelNode> {}

export class ModelPosition extends Position<IModelNode> {}

export interface IAttributes {
    [key: string]: any;
}

export interface IModelNode<
    TAttributes extends IAttributes = {},
    TParent extends IModelNode = IModelNode<any, any, any>,
    TChild extends IModelNode = IModelNode<any, any, any>
> extends INode<TParent, TChild> {
    getComponentId(): string;
    getPartId(): string;
    getAttributes(): TAttributes;
    getSize(): number;
    clearCache(): void;
    resolvePosition(offset: number, depth?: number): IModelPosition;
    toTokens(): IToken[];
    toDOM(from: number, to: number): HTMLElement;
    clone(): ModelNode<TAttributes, TParent, TChild>;
}

export abstract class ModelNode<TAttributes extends IAttributes, TParent extends IModelNode, TChild extends IModelNode>
    extends Node<TParent, TChild>
    implements IModelNode<TAttributes, TParent, TChild> {
    abstract getPartId(): string;
    abstract getSize(): number;
    abstract clearOwnCache(): void;
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

    getId() {
        return this.id;
    }

    getAttributes() {
        return this.attributes;
    }

    clearCache() {
        this.clearOwnCache();
        if (!this.isRoot()) {
            this.getParent()!.clearCache();
        }
    }
}
