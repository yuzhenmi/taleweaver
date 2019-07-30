import Editor from '../Editor';
import PageNode from './PageViewNode';
import ViewNode from './ViewNode';

export type ChildNode = PageNode;

export default class DocViewNode extends ViewNode<never, ChildNode> {
    protected size?: number;
    protected domContainer: HTMLDivElement;

    constructor(editor: Editor) {
        super(editor, 'Doc');
        this.domContainer = document.createElement('div');
        this.domContainer.className = 'tw--doc';
        this.domContainer.setAttribute('data-tw-instance', editor.getID());
        this.domContainer.setAttribute('data-tw-id', id);
        this.domContainer.setAttribute('data-tw-role', 'doc');
        this.domContainer.style.textAlign = 'left';
        this.domContainer.style.cursor = 'text';
        this.domContainer.style.userSelect = 'none';
    }

    isRoot() {
        return true;
    }

    isLeaf() {
        return false;
    }

    getType() {
        return 'Doc';
    }

    getSize() {
        if (this.size === undefined) {
            this.size = this.getChildNodes().reduce((size, childNode) => size + childNode.getSize(), 0);
        }
        return this.size;
    }

    clearCache() {
        this.size = undefined;
    }

    getDOMContainer() {
        return this.domContainer;
    }
}
