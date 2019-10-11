import Editor from '../Editor';
import LayoutUpdatedEvent from '../events/LayoutUpdatedEvent';
import RenderUpdatedEvent from '../events/RenderUpdatedEvent';
import AtomicRenderNode from '../render/AtomicRenderNode';
import BlockRenderNode from '../render/BlockRenderNode';
import InlineRenderNode from '../render/InlineRenderNode';
import { AnyRenderNode } from '../render/RenderNode';
import DocLayoutNode from './DocLayoutNode';
import { AnyLayoutNode } from './LayoutNode';
import LayoutReflower from './LayoutReflower';
import LayoutTreeBuilder from './LayoutTreeBuilder';

export default class LayoutEngine {
    protected editor: Editor;
    protected doc: DocLayoutNode;

    constructor(editor: Editor) {
        this.editor = editor;
        this.doc = new DocLayoutNode(editor);
        editor.getDispatcher().on(RenderUpdatedEvent, this.handleRenderUpdatedEvent);
    }

    getDoc() {
        return this.doc;
    }

    protected handleRenderUpdatedEvent = (event: RenderUpdatedEvent) => {
        let updatedRenderNode: AnyRenderNode = event.getUpdatedNode();
        if (updatedRenderNode instanceof AtomicRenderNode) {
            updatedRenderNode = updatedRenderNode.getParent()!.getParent()!;
        } else if (updatedRenderNode instanceof InlineRenderNode) {
            updatedRenderNode = updatedRenderNode.getParent()!;
        } else if (updatedRenderNode instanceof BlockRenderNode) {
            updatedRenderNode = updatedRenderNode.getParent()!;
        }
        const node = this.doc.findDescendant(updatedRenderNode.getID()) as AnyLayoutNode;
        const layoutTreeBuilder = new LayoutTreeBuilder(this.editor, updatedRenderNode);
        const updatedNode = layoutTreeBuilder.run();
        node.onUpdated(updatedNode);
        this.deduplicateNode(node);
        this.clearAncestorsCache(node);
        const layoutReflower = new LayoutReflower(this.editor, node);
        const reflowedNode = layoutReflower.run();
        this.editor.getDispatcher().dispatch(new LayoutUpdatedEvent(reflowedNode));
    }

    protected clearAncestorsCache(node: AnyLayoutNode) {
        let currentNode = node;
        while (true) {
            currentNode.clearCache();
            if (currentNode.isRoot()) {
                break;
            }
            currentNode = currentNode.getParent();
        }
    }

    protected deduplicateNode(node: AnyLayoutNode) {
        if (node.isRoot()) {
            return;
        }
        let nextNode = node.getNextSiblingAllowCrossParent();
        let nodeToDelete: AnyLayoutNode;
        while (nextNode && nextNode.getID() === node.getID()) {
            nodeToDelete = nextNode;
            nextNode = nextNode.getNextSiblingAllowCrossParent();
            nodeToDelete.getParent()!.removeChild(nodeToDelete);
        }
    }
}
