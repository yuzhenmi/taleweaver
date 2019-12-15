import { INode, Node } from 'tw/tree/node';
import { IPosition, Position } from 'tw/tree/position';

export interface IRenderPosition extends IPosition<IRenderNode> {}

export interface IStyle {
    [key: string]: any;
}

export interface IRenderNode<
    TStyle extends IStyle = {},
    TParent extends IRenderNode = IRenderNode<any, any, any>,
    TChild extends IRenderNode = IRenderNode<any, any, any>
> extends INode<TParent, TChild> {
    getComponentId(): string;
    getPartId(): string;
    getSize(): number;
    getModelSize(): number;
    getStyle(): TStyle;
    resolvePosition(offset: number, depth?: number): IRenderPosition;
    convertOffsetToModelOffset(offset: number): number;
}

export class RenderPosition extends Position<IRenderNode> implements IRenderPosition {}

export abstract class RenderNode<TStyle extends IStyle, TParent extends IRenderNode, TChild extends IRenderNode>
    extends Node<TParent, TChild>
    implements IRenderNode<TStyle, TParent, TChild> {
    abstract getPartId(): string;
    abstract getSize(): number;
    abstract getModelSize(): number;
    abstract resolvePosition(offset: number, depth?: number): IRenderPosition;
    abstract convertOffsetToModelOffset(offset: number): number;

    constructor(protected componentId: string, protected id: string, protected style: TStyle) {
        super();
    }

    getComponentId() {
        return this.componentId;
    }

    getId() {
        return this.id;
    }

    getStyle() {
        return this.style;
    }
}
