import Editor from '../Editor';
import ModelUpdatedEvent from '../events/ModelUpdatedEvent';
import RenderUpdatedEvent from '../events/RenderUpdatedEvent';
import DocRenderNode from './DocRenderNode';
import { AnyRenderNode } from './RenderNode';
import RenderTreeBuilder from './RenderTreeBuilder';

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
        const node = this.doc.findDescendant(updatedModelNode.getID()) as AnyRenderNode;
        const renderTreeBuilder = new RenderTreeBuilder(this.editor, updatedModelNode);
        const updatedNode = renderTreeBuilder.run();
        node.onUpdated(updatedNode);
        this.clearAncestorsCache(node);
        this.editor.getDispatcher().dispatch(new RenderUpdatedEvent(node));
    };

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
