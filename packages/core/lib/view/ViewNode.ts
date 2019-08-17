import Editor from '../Editor';
import { AnyLayoutNode } from '../layout/LayoutNode';
import Node from '../tree/Node';

export type AnyViewNode = ViewNode<any, any, any>;

export default abstract class ViewNode<L extends AnyLayoutNode, P extends AnyViewNode, C extends AnyViewNode> extends Node<P, C> {
    abstract getType(): string;
    abstract getSize(): number;
    abstract clearCache(): void;
    abstract appendDOMChild(domChild: HTMLElement): void;
    abstract insertDOMBefore(domChild: HTMLElement, beforeDOMChild: HTMLElement): void;
    abstract removeDOMChild(domChild: HTMLElement): void;
    abstract getDOMContainer(): HTMLElement;
    protected abstract updateDOM(): void;

    protected editor: Editor;
    protected layoutNode: L;

    constructor(editor: Editor, layoutNode: L) {
        super();
        this.editor = editor;
        this.layoutNode = layoutNode;
    }

    getID() {
        return this.layoutNode.getID();
    }

    appendChild(child: C) {
        super.appendChild(child);
        this.appendDOMChild(child.getDOMContainer());
    }

    insertBefore(child: C, beforeChild: C) {
        super.insertBefore(child, beforeChild);
        this.insertDOMBefore(child.getDOMContainer(), beforeChild.getDOMContainer());
    }

    removeChild(child: C) {
        super.removeChild(child);
        this.removeDOMChild(child.getDOMContainer());
    }

    getLayoutNode() {
        return this.layoutNode;
    }

    onUpdated(updatedNode: this) {
        super.onUpdated(updatedNode);
        this.layoutNode = updatedNode.getLayoutNode();
        this.clearCache();
        this.updateDOM();
    }

    onDeleted() {
        const domContainer = this.getDOMContainer();
        const parentDOMElement = domContainer.parentElement;
        if (parentDOMElement) {
            parentDOMElement.removeChild(domContainer);
        }
    }
}
