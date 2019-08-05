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

function findNodeByRenderID(renderID: string, node: AnyLayoutNode): AnyLayoutNode | null {
    if (node.getID() === renderID) {
        return node;
    }
    const childNodes = node.getChildNodes();
    for (let n = 0, nn = childNodes.length; n < nn; n++) {
        const foundNode = findNodeByRenderID(renderID, childNodes[n]);
        if (foundNode) {
            return foundNode;
        }
    }
    return null;
}

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
        const node = this.findNodeByRenderID(updatedRenderNode.getID());
        const layoutTreeBuilder = new LayoutTreeBuilder(this.editor, updatedRenderNode);
        const updatedNode = layoutTreeBuilder.run();
        node.onUpdated(updatedNode);
        this.clearAncestorsCache(node);
        const layoutReflower = new LayoutReflower(this.editor, node);
        const reflowedNode = layoutReflower.run();
        this.editor.getDispatcher().dispatch(new LayoutUpdatedEvent(reflowedNode));
    }

    protected findNodeByRenderID(renderID: string) {
        return findNodeByRenderID(renderID, this.doc)!;
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
}
