import { INode, Node } from 'tw/tree/node';
import { IPosition, Position } from 'tw/tree/position';

export interface ILayoutPosition extends IPosition<ILayoutNode> {}

export class LayoutPosition extends Position<ILayoutNode> {}

export interface IStyle {
    [key: string]: any;
}

export interface ILayoutNode<
    TParent extends ILayoutNode = ILayoutNode<any, any>,
    TChild extends ILayoutNode = ILayoutNode<any, any>
> extends INode<TParent, TChild> {
    getComponentId(): string;
    getPartId(): string;
    getSize(): number;
    clearCache(): void;
    resolvePosition(offset: number, depth?: number): ILayoutPosition;
}

export abstract class LayoutNode<TParent extends ILayoutNode, TChild extends ILayoutNode> extends Node<TParent, TChild>
    implements ILayoutNode<TParent, TChild> {
    abstract getPartId(): string;
    abstract getSize(): number;
    abstract clearOwnCache(): void;
    abstract resolvePosition(offset: number, depth?: number): ILayoutPosition;

    constructor(protected componentId: string, protected id: string) {
        super();
    }

    getComponentId() {
        return this.componentId;
    }

    getId() {
        return this.id;
    }

    clearCache() {
        this.clearOwnCache();
        if (!this.isRoot()) {
            const parent = this.getParent();
            if (parent) {
                parent.clearCache();
            }
        }
    }
}
