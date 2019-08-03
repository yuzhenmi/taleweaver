import Editor from '../Editor';
import Node from '../tree/Node';

export type AnyViewNode = ViewNode<any, any>;

export default abstract class ViewNode<P extends AnyViewNode, C extends AnyViewNode> extends Node<P, C> {
    abstract getType(): string;
    abstract getSize(): number;
    abstract clearCache(): void;
    abstract getDOMContainer(): HTMLElement;

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
