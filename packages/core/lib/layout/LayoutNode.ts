import Editor from '../Editor';
import Node from '../tree/Node';

export type AnyLayoutNode = LayoutNode<any, any>;

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

    onUpdated(updatedNode: this) {
        super.onUpdated(updatedNode);
        this.clearCache();
    }
}
