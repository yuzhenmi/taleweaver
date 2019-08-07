import Editor from '../Editor';
import LayoutUpdatedEvent from '../events/LayoutUpdatedEvent';
import ViewUpdatedEvent from '../events/ViewUpdatedEvent';
import DocViewNode from './DocViewNode';
import { AnyViewNode } from './ViewNode';
import ViewTreeBuilder from './ViewTreeBuilder';

class ViewEngine {
    protected editor: Editor;
    protected doc: DocViewNode;

    constructor(editor: Editor) {
        this.editor = editor;
        this.doc = new DocViewNode(editor);
        editor.getDispatcher().on(LayoutUpdatedEvent, this.handleLayoutUpdatedEvent);
    }

    attachToDOM(domContainer: HTMLElement) {
        this.doc.attachToDOM(domContainer);
    }

    getDoc() {
        return this.doc;
    }

    protected handleLayoutUpdatedEvent = (event: LayoutUpdatedEvent) => {
        const updatedLayoutNode = event.getUpdatedNode();
        const node = this.doc.findDescendant(updatedLayoutNode.getID())! as AnyViewNode;
        const builder = new ViewTreeBuilder(this.editor, updatedLayoutNode);
        const updatedNode = builder.run();
        node.onUpdated(updatedNode);
        this.clearAncestorsCache(node);
        this.editor.getDispatcher().dispatch(new ViewUpdatedEvent(node));
    }

    protected clearAncestorsCache(node: AnyViewNode) {
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

export default ViewEngine;
