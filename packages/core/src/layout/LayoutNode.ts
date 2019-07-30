import Editor from '../Editor';
import Node, { Position } from '../tree/Node';

export type AnyLayoutNode = LayoutNode<any, any>;

export type LayoutPosition = Position<AnyLayoutNode>;

export default abstract class LayoutNode<P extends AnyLayoutNode, C extends AnyLayoutNode> extends Node<P, C> {
    abstract getType(): string;
    abstract getSize(): number;
    abstract clearCache(): void;

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

    onUpdated(updatedNode: LayoutNode<P, C>) {
        if (!this.isLeaf()) {
            const updatedChildNodes = updatedNode.getChildNodes();
            const childNodes: C[] = [];
            for (let n = 0; n < updatedChildNodes.length; n++) {
                const updatedChildNode = updatedChildNodes[n];
                const childNode = this.getChildNodes().find((childNode) =>
                    childNode!.getID() === updatedChildNode!.getID()
                );
                if (childNode) {
                    childNode.onUpdated(updatedChildNode!);
                    this.appendChild(childNode);
                } else {
                    this.appendChild(updatedChildNode);
                }
            }
            this.getChildNodes().forEach(childNode => {
                this.removeChild(childNode);
            });
            childNodes.forEach(childNode => {
                this.appendChild(childNode);
            });
        }
        this.clearCache();
    }
}
