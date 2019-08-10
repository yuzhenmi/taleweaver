import Editor from '../Editor';
import LineLayoutNode from '../layout/LineLayoutNode';
import BlockNode from './BlockViewNode';
import InlineNode from './InlineViewNode';
import ViewNode from './ViewNode';

export type ParentNode = BlockNode;
export type ChildNode = InlineNode;

export default class LineViewNode extends ViewNode<ParentNode, ChildNode> {
    protected layoutNode: LineLayoutNode;
    protected size?: number;
    protected domContainer: HTMLDivElement;

    constructor(editor: Editor, layoutNode: LineLayoutNode) {
        super(editor, layoutNode.getID());
        this.layoutNode = layoutNode;
        this.domContainer = document.createElement('div');
        this.domContainer.className = 'tw--line';
        this.domContainer.setAttribute('data-tw-id', this.id);
        this.domContainer.setAttribute('data-tw-role', 'line');
        this.domContainer.style.whiteSpace = 'pre';
        this.domContainer.style.lineHeight = '0';
        this.updateDOM();
    }

    isRoot() {
        return false;
    }

    isLeaf() {
        return false;
    }

    getType() {
        return 'Page';
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

    appendDOMChild(domChild: HTMLElement) {
        this.domContainer.appendChild(domChild);
    }

    insertDOMBefore(domChild: HTMLElement, beforeDOMChild: HTMLElement) {
        this.domContainer.insertBefore(domChild, beforeDOMChild);
    }

    removeDOMChild(domChild: HTMLElement) {
        this.domContainer.removeChild(domChild);
    }

    getDOMContainer() {
        return this.domContainer;
    }

    protected updateDOM() { }
}
