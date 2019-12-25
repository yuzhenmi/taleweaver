import { INode, Node } from '../tree/node';
import { IPosition, Position } from '../tree/position';

export type ILayoutNodeClass = 'doc' | 'page' | 'block' | 'line' | 'inline' | 'atomic';

export interface ILayoutPosition extends IPosition<ILayoutNode> {}

export interface ILayoutNode<
    TParent extends ILayoutNode = ILayoutNode<any, any>,
    TChild extends ILayoutNode = ILayoutNode<any, any>
> extends INode<TParent, TChild> {
    getNodeClass(): ILayoutNodeClass;
    getComponentId(): string;
    getPartId(): string;
    getSize(): number;
    getWidth(): number;
    getHeight(): number;
    getInnerWidth(): number;
    getInnerHeight(): number;
    getPaddingTop(): number;
    getPaddingBottom(): number;
    getPaddingLeft(): number;
    getPaddingRight(): number;
    getVerticalPaddng(): number;
    getHorizontalPaddng(): number;
    resolvePosition(offset: number, depth?: number): ILayoutPosition;
}

export class LayoutPosition extends Position<ILayoutNode> implements ILayoutPosition {}

export abstract class LayoutNode<TParent extends ILayoutNode, TChild extends ILayoutNode> extends Node<TParent, TChild>
    implements ILayoutNode<TParent, TChild> {
    abstract getNodeClass(): ILayoutNodeClass;
    abstract getPartId(): string;
    abstract getSize(): number;
    abstract getWidth(): number;
    abstract getHeight(): number;
    abstract getPaddingTop(): number;
    abstract getPaddingBottom(): number;
    abstract getPaddingLeft(): number;
    abstract getPaddingRight(): number;
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

    getInnerWidth() {
        return this.getWidth() - this.getHorizontalPaddng();
    }

    getInnerHeight() {
        return this.getHeight() - this.getVerticalPaddng();
    }

    getVerticalPaddng() {
        return this.getPaddingTop() + this.getPaddingBottom();
    }

    getHorizontalPaddng() {
        return this.getPaddingLeft() + this.getPaddingRight();
    }
}
