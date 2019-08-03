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

    onUpdated(updatedNode: RenderNode<P, C>) {
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
