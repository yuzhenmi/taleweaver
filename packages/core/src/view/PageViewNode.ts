import Editor from '../Editor';
import BlockNode from './BlockViewNode';
import DocNode from './DocViewNode';
import ViewNode from './ViewNode';

export type ParentNode = DocNode;
export type ChildNode = BlockNode;

export default class PageViewNode extends ViewNode<ParentNode, ChildNode> {
    protected size?: number;
    protected domContainer: HTMLDivElement;
    protected domContentContainer: HTMLDivElement;
    protected domContentInnerContainer: HTMLDivElement;

    constructor(editor: Editor, id: string) {
        super(editor, id);
        this.domContainer = document.createElement('div');
        this.domContainer.className = 'tw--page';
        this.domContainer.setAttribute('data-tw-instance', editor.getID());
        this.domContainer.setAttribute('data-tw-id', id);
        this.domContainer.setAttribute('data-tw-role', 'page');
        this.domContentContainer = document.createElement('div');
        this.domContentContainer.className = 'tw--page-inner';
        this.domContentContainer.style.position = 'relative';
        this.domContentContainer.style.marginLeft = 'auto';
        this.domContentContainer.style.marginRight = 'auto';
        this.domContainer.appendChild(this.domContentContainer);
        this.domContentInnerContainer = document.createElement('div');
        this.domContentInnerContainer.className = 'tw--page-content';
        this.domContentInnerContainer.setAttribute('data-tw-role', 'page-content');
        this.domContentContainer.appendChild(this.domContentInnerContainer);
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

    getDOMContainer() {
        return this.domContainer;
    }

    getDOMContentContainer() {
        return this.domContentContainer;
    }

    getDOMContentInnerContainer() {
        return this.domContentInnerContainer;
    }
}
