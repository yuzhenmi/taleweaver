import Editor from '../Editor';
import ModelUpdatedEvent from '../events/ModelUpdatedEvent';
import RenderUpdatedEvent from '../events/RenderUpdatedEvent';
import DocRenderNode from './DocRenderNode';
import { AnyRenderNode } from './RenderNode';
import RenderTreeBuilder from './RenderTreeBuilder';

function findNodeByModelID(modelID: string, node: AnyRenderNode): AnyRenderNode | null {
    if (node.getID() === modelID) {
        return node;
    }
    const childNodes = node.getChildNodes();
    for (let n = 0, nn = childNodes.length; n < nn; n++) {
        const foundNode = findNodeByModelID(modelID, childNodes[n]);
        if (foundNode) {
            return foundNode;
        }
    }
    return null;
}

export default class RenderEngine {
    protected editor: Editor;
    protected doc: DocRenderNode;

    constructor(editor: Editor) {
        this.editor = editor;
        this.doc = new DocRenderNode(editor);
        editor.getDispatcher().on(ModelUpdatedEvent, this.handleModelUpdatedEvent);
    }

    getDoc() {
        return this.doc;
    }

    protected handleModelUpdatedEvent = (event: ModelUpdatedEvent) => {
        const updatedModelNode = event.getUpdatedNode();
        const node = this.findNodeByModelID(updatedModelNode.getID());
        const renderTreeBuilder = new RenderTreeBuilder(this.editor, updatedModelNode);
        const updatedNode = renderTreeBuilder.run();
        node.onUpdated(updatedNode);
        this.clearAncestorsCache(node);
        this.editor.getDispatcher().dispatch(new RenderUpdatedEvent(node));
    }

    protected findNodeByModelID(modelID: string) {
        return findNodeByModelID(modelID, this.doc)!;
    }

    protected clearAncestorsCache(node: AnyRenderNode) {
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
