import { ILayoutNode } from 'tw/layout/node';
import { INode, Node } from 'tw/tree/node';

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
    insertChildDOM(childDOM: HTMLElement): void;
    insertChildDOMBefore(childDOM: HTMLElement, beforeChildDOM: HTMLElement): void;
    appendChildDOM(childDOM: HTMLElement): void;
    appendChildDOMAfter(childDOM: HTMLElement, afterChildDOM: HTMLElement): void;
    removeChildDOM(childDOM: HTMLElement): void;
    getLayoutNode(): TLayoutNode;
}

export abstract class ViewNode<TLayoutNode extends ILayoutNode, TParent extends IViewNode, TChild extends IViewNode>
    extends Node<TParent, TChild>
    implements IViewNode<TLayoutNode, TParent, TChild> {
    abstract getNodeClass(): IViewNodeClass;
    abstract getDOMContainer(): HTMLElement;

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

    insertChildDOM(childDOM: HTMLElement) {
        const domContentContainer = this.getDOMContentContainer();
        domContentContainer.insertBefore(childDOM, domContentContainer.firstChild);
    }

    insertChildDOMBefore(childDOM: HTMLElement, beforeChildDOM: HTMLElement) {
        const domContentContainer = this.getDOMContentContainer();
        domContentContainer.insertBefore(childDOM, beforeChildDOM);
    }

    appendChildDOM(childDOM: HTMLElement) {
        const domContentContainer = this.getDOMContentContainer();
        domContentContainer.appendChild(childDOM);
    }

    appendChildDOMAfter(childDOM: HTMLElement, afterChildDOM: HTMLElement) {
        const domContentContainer = this.getDOMContentContainer();
        domContentContainer.insertBefore(childDOM, afterChildDOM.nextSibling);
    }

    removeChildDOM(childDOM: HTMLElement) {
        const domContentContainer = this.getDOMContentContainer();
        domContentContainer.removeChild(childDOM);
    }

    getLayoutNode() {
        return this.layoutNode;
    }

    onDidUpdate(updatedNode: this) {
        super.onDidUpdate(updatedNode);
        this.layoutNode = updatedNode.getLayoutNode();
        this.onLayoutDidUpdate();
    }

    protected onLayoutDidUpdate() {}
}
