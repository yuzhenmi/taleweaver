import { ILayoutNode } from 'tw/layout/node';
import { INode, Node } from 'tw/tree/node';

export type IViewNodeClass = 'doc' | 'page' | 'block' | 'line' | 'inline';

export interface IViewNode<
    TParent extends IViewNode = IViewNode<any, any>,
    TChild extends IViewNode = IViewNode<any, any>
> extends INode<TParent, TChild> {
    getNodeClass(): IViewNodeClass;
    getComponentId(): string;
    getPartId(): string;
    getSize(): number;
}

export abstract class ViewNode<TLayoutNode extends ILayoutNode, TParent extends IViewNode, TChild extends IViewNode>
    extends Node<TParent, TChild>
    implements IViewNode<TParent, TChild> {
    abstract getNodeClass(): IViewNodeClass;

    constructor(protected layoutNode: TLayoutNode) {
        super();
    }

    getComponentId() {
        return this.layoutNode.getComponentId();
    }

    getPartId() {
        return this.layoutNode.getPartId();
    }

    getId() {
        return this.layoutNode.getId();
    }

    getSize() {
        return this.layoutNode.getSize();
    }
}
