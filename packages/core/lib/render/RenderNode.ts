import Editor from '../Editor';
import Node from '../tree/Node';

export type AnyRenderNode = RenderNode<any, any>;

export default abstract class RenderNode<P extends AnyRenderNode, C extends AnyRenderNode> extends Node<P, C> {
    abstract getType(): string;
    abstract getSize(): number;
    abstract getModelSize(): number;
    abstract clearCache(): void;
    abstract convertOffsetToModelOffset(offset: number): number;

    protected editor: Editor;
    protected id: string;

    constructor(editor: Editor, id: string) {
        super();
        this.editor = editor;
        this.id = id;
    }

    getID(): string {
        return this.id;
    }

    onUpdated(updatedNode: this) {
        super.onUpdated(updatedNode);
        this.clearCache();
    }
}
