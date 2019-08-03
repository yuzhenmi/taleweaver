import Editor from '../Editor';
import ModelUpdatedEvent from '../events/ModelUpdatedEvent';
import StateUpdatedEvent from '../events/StateUpdatedEvent';
import DocModelNode from './DocModelNode';
import { AnyModelNode } from './ModelNode';
import ModelPosition from './ModelPosition';
import TokenParser from './StateParser';

export default class ModelEngine {
    protected editor: Editor;
    protected doc: DocModelNode;

    constructor(editor: Editor) {
        this.editor = editor;
        this.doc = new DocModelNode(editor);
        editor.getDispatcher().on(StateUpdatedEvent, this.handleStateUpdatedEvent);
    }

    getDoc() {
        return this.doc;
    }

    protected handleStateUpdatedEvent = (event: StateUpdatedEvent) => {
        const position = this.doc.resolvePosition(event.getBeforeFrom());
        const tokens = this.editor.getStateService().getTokens();
        const parser = new TokenParser(this.editor, tokens);
        const updatedNode = parser.run();
        let node: AnyModelNode | null = null;
        let currentPosition: ModelPosition | null = position;
        while (currentPosition) {
            if (currentPosition.getNode().getID() === updatedNode.getID()) {
                node = currentPosition.getNode();
                break;
            }
            currentPosition = currentPosition.getChild();
        }
        if (!node) {
            throw new Error('Error identifying updated model node.');
        }
        node.onUpdated(updatedNode);
        this.editor.getDispatcher().dispatch(new ModelUpdatedEvent(node));
    }
}
