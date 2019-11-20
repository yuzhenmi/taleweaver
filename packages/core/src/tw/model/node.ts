import { IAttributes, IToken } from 'tw/state/token';
import { INode, Node } from 'tw/tree/node';
import { IPosition, Position } from 'tw/tree/position';

export interface IModelPosition extends IPosition<IModelNode<any>> {}

export class ModelPosition extends Position<IModelNode<any>> {}

export interface IModelNode<
    TAttributes extends IAttributes,
    TParent extends IModelNode<any> | undefined = IModelNode<any, any, any>,
    TChild extends IModelNode<any> | undefined = IModelNode<any, any, any>
> extends INode<TParent, TChild> {
    getElementId(): string;
    getType(): string;
    getAttributes(): TAttributes;
    getSize(): number;
    resolvePosition(offset: number, depth?: number): IModelPosition;
    clearCache(): void;
    toTokens(): IToken[];
    toHTML(from: number, to: number): HTMLElement;
}

export abstract class ModelNode<
    TAttributes,
    TParent extends IModelNode<any> | undefined,
    TChild extends IModelNode<any> | undefined
> extends Node<TParent, TChild> implements IModelNode<TAttributes, TParent, TChild> {
    abstract getElementId(): string;
    abstract getType(): string;
    abstract getSize(): number;
    abstract clearCache(): void;
    abstract toHTML(from: number, to: number): HTMLElement;
    abstract toTokens(): IToken[];
    abstract resolvePosition(offset: number, depth?: number): IModelPosition;

    constructor(protected id: string, protected attributes: TAttributes) {
        super();
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

    getAttributes() {
        return this.attributes;
    }

    clone() {
        // @ts-ignore
        return new this.constructor(this.editor, this.id, this.attributes);
    }

    onUpdated(updatedNode: this) {
        this.attributes = updatedNode.attributes;
        super.onUpdated(updatedNode);
        this.clearCache();
    }
}
