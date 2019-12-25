import { ILayoutNode } from '../layout/node';
import { INode, Node } from '../tree/node';

export type IViewNodeClass = 'doc' | 'page' | 'block' | 'line' | 'inline';

export interface IViewNode<
    TLayoutNode extends ILayoutNode = ILayoutNode,
    TParent extends IViewNode = IViewNode<any, any, any>,
    TChild extends IViewNode = IViewNode<any, any, any>
> extends INode<TParent, TChild> {
    getNodeClass(): IViewNodeClass;
    getComponentId(): string;
    getPartId(): string;
    getSize(): number;
    getDOMContainer(): HTMLElement;
    getLayoutNode(): TLayoutNode;
    onLayoutDidUpdate(): void;
}

export abstract class ViewNode<TLayoutNode extends ILayoutNode, TParent extends IViewNode, TChild extends IViewNode>
    extends Node<TParent, TChild>
    implements IViewNode<TLayoutNode, TParent, TChild> {
    abstract getNodeClass(): IViewNodeClass;
    abstract getDOMContainer(): HTMLElement;
    abstract onLayoutDidUpdate(): void;

    protected abstract getDOMContentContainer(): HTMLElement;

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

    insertChild(child: TChild) {
        super.insertChild(child);
        this.insertChildDOM(child.getDOMContainer());
    }

    insertChildBefore(child: TChild, beforeChild: TChild) {
        super.insertChildBefore(child, beforeChild);
        this.insertChildDOMBefore(child.getDOMContainer(), beforeChild.getDOMContainer());
    }

    appendChild(child: TChild) {
        super.appendChild(child);
        this.appendChildDOM(child.getDOMContainer());
    }

    appendChildAfter(child: TChild, afterChild: TChild) {
        super.appendChildAfter(child, afterChild);
        this.appendChildDOMAfter(child.getDOMContainer(), afterChild.getDOMContainer());
    }

    removeChild(child: TChild) {
        super.removeChild(child);
        this.removeChildDOM(child.getDOMContainer());
    }

    getLayoutNode() {
        return this.layoutNode;
    }

    onDidUpdate(updatedNode: this) {
        super.onDidUpdate(updatedNode);
        this.layoutNode = updatedNode.getLayoutNode();
        this.onLayoutDidUpdate();
    }

    protected insertChildDOM(childDOM: HTMLElement) {
        const domContentContainer = this.getDOMContentContainer();
        domContentContainer.insertBefore(childDOM, domContentContainer.firstChild);
    }

    protected insertChildDOMBefore(childDOM: HTMLElement, beforeChildDOM: HTMLElement) {
        const domContentContainer = this.getDOMContentContainer();
        domContentContainer.insertBefore(childDOM, beforeChildDOM);
    }

    protected appendChildDOM(childDOM: HTMLElement) {
        const domContentContainer = this.getDOMContentContainer();
        domContentContainer.appendChild(childDOM);
    }

    protected appendChildDOMAfter(childDOM: HTMLElement, afterChildDOM: HTMLElement) {
        const domContentContainer = this.getDOMContentContainer();
        domContentContainer.insertBefore(childDOM, afterChildDOM.nextSibling);
    }

    protected removeChildDOM(childDOM: HTMLElement) {
        const domContentContainer = this.getDOMContentContainer();
        domContentContainer.removeChild(childDOM);
    }
}
