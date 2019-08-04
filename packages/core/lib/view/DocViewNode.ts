import Editor from '../Editor';
import PageNode from './PageViewNode';
import ViewNode from './ViewNode';

export type ChildNode = PageNode;

export default class DocViewNode extends ViewNode<never, ChildNode> {
    protected size?: number;
    protected domContainer: HTMLDivElement;
    protected isAttachedToDOM: boolean = false;
    protected parentDOMContainer?: HTMLElement;

    constructor(editor: Editor) {
        super(editor, 'Doc');
        this.domContainer = document.createElement('div');
        this.domContainer.className = 'tw--doc';
        this.domContainer.setAttribute('data-tw-instance', editor.getID());
        this.domContainer.setAttribute('data-tw-id', this.id);
        this.domContainer.setAttribute('data-tw-role', 'doc');
        this.domContainer.style.textAlign = 'left';
        this.domContainer.style.cursor = 'text';
        this.domContainer.style.userSelect = 'none';
        this.updateDOM();
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

    getIsAttachedToDOM() {
        return this.isAttachedToDOM
    }

    attachToDOM(parentDOMContainer: HTMLElement) {
        if (this.isAttachedToDOM) {
            throw new Error('Taleweaver is already attached to the DOM.');
        }
        parentDOMContainer.appendChild(this.domContainer);
        this.isAttachedToDOM = true;
        this.parentDOMContainer = parentDOMContainer;
    }

    protected updateDOM() { }
}
