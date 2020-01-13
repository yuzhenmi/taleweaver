import { IToken } from '../state/token';
import { INode, Node } from '../tree/node';
import { IPosition, Position } from '../tree/position';

export interface IModelPosition extends IPosition<IModelNode> {}

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
    resolvePosition(offset: number, depth?: number): IModelPosition;
    toTokens(): IToken[];
    toDOM(from: number, to: number): HTMLElement;
    clone(): ModelNode<TAttributes, TParent, TChild>;
}

export class ModelPosition extends Position<IModelNode> implements IModelPosition {}

export abstract class ModelNode<TAttributes extends IAttributes, TParent extends IModelNode, TChild extends IModelNode>
    extends Node<TParent, TChild>
    implements IModelNode<TAttributes, TParent, TChild> {
    abstract getPartId(): string;
    abstract getSize(): number;
    abstract resolvePosition(offset: number, depth?: number): IModelPosition;
    abstract toDOM(from: number, to: number): HTMLElement;
    abstract toTokens(): IToken[];
    abstract clone(): ModelNode<TAttributes, TParent, TChild>;

    constructor(protected componentId: string, protected id: string, protected attributes: TAttributes) {
        super();
    }

    getComponentId() {
        return this.componentId;
    }

    getId() {
        return this.id;
    }

    getAttributes() {
        return this.attributes;
    }
}
