import Editor from '../Editor';
import Node from '../tree/Node';

export type AnyViewNode = ViewNode<any, any>;

export default abstract class ViewNode<P extends AnyViewNode, C extends AnyViewNode> extends Node<P, C> {
    abstract getType(): string;
    abstract getSize(): number;
    abstract clearCache(): void;
    abstract appendDOMChild(domChild: HTMLElement): void;
    abstract insertDOMBefore(domChild: HTMLElement, beforeDOMChild: HTMLElement): void;
    abstract removeDOMChild(domChild: HTMLElement): void;
    abstract getDOMContainer(): HTMLElement;
    protected abstract updateDOM(): void;

    protected editor: Editor;
    protected id: string;

    constructor(editor: Editor, id: string) {
        super();
        this.editor = editor;
        this.id = id;
    }

    getID() {
        return this.id;
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

    onUpdated(updatedNode: ViewNode<P, C>) {
        if (!this.isLeaf()) {
            const updatedChildNodes = updatedNode.getChildNodes();
            const childNodes = this.getChildNodes().slice();
            this.getChildNodes().forEach(childNode => {
                this.removeChild(childNode);
            });
            for (let n = 0; n < updatedChildNodes.length; n++) {
                const updatedChildNode = updatedChildNodes[n];
                const childNode = childNodes.find((childNode) =>
                    childNode!.getID() === updatedChildNode!.getID()
                );
                if (childNode) {
                    childNode.onUpdated(updatedChildNode!);
                    this.appendChild(childNode);
                } else {
                    this.appendChild(updatedChildNode);
                }
            }
        }
        this.clearCache();
    }

    onDeleted() {
        const domContainer = this.getDOMContainer();
        const parentDOMElement = domContainer.parentElement;
        if (parentDOMElement) {
            parentDOMElement.removeChild(domContainer);
        }
    }
}
