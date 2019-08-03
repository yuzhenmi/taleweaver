import Editor from '../Editor';
import LayoutUpdatedEvent from '../events/LayoutUpdatedEvent';
import ViewUpdatedEvent from '../events/ViewUpdatedEvent';
import DocViewNode from './DocViewNode';
import { AnyViewNode } from './ViewNode';
import ViewTreeBuilder from './ViewTreeBuilder';

function findNodeByLayoutID(layoutID: string, node: AnyViewNode): AnyViewNode | null {
    if (node.getID() === layoutID) {
        return node;
    }
    const childNodes = node.getChildNodes();
    for (let n = 0, nn = childNodes.length; n < nn; n++) {
        const foundNode = findNodeByLayoutID(layoutID, childNodes[n]);
        if (foundNode) {
            return foundNode;
        }
    }
    return null;
}

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
        const node = this.findNodeByLayoutID(updatedLayoutNode.getID());
        const builder = new ViewTreeBuilder(this.editor, updatedLayoutNode);
        const updatedNode = builder.run();
        node.onUpdated(updatedNode);
        this.editor.getDispatcher().dispatch(new ViewUpdatedEvent(node));
    }

    protected findNodeByLayoutID(layoutID: string) {
        return findNodeByLayoutID(layoutID, this.doc)!;
    }
}

export default ViewEngine;
