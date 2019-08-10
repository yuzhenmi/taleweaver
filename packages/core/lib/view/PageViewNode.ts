import Editor from '../Editor';
import PageLayoutNode from '../layout/PageLayoutNode';
import BlockNode from './BlockViewNode';
import DocNode from './DocViewNode';
import ViewNode from './ViewNode';

export type ParentNode = DocNode;
export type ChildNode = BlockNode;

export default class PageViewNode extends ViewNode<ParentNode, ChildNode> {
    protected layoutNode: PageLayoutNode;
    protected size?: number;
    protected domContainer: HTMLDivElement;
    protected domContentContainer: HTMLDivElement;
    protected domContentInnerContainer: HTMLDivElement;

    constructor(editor: Editor, layoutNode: PageLayoutNode) {
        super(editor, layoutNode.getID());
        this.layoutNode = layoutNode;
        this.domContainer = document.createElement('div');
        this.domContainer.className = 'tw--page';
        this.domContainer.setAttribute('data-tw-instance', editor.getID());
        this.domContainer.setAttribute('data-tw-id', this.id);
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
        this.domContentInnerContainer.appendChild(domChild);
    }

    insertDOMBefore(domChild: HTMLElement, beforeDOMChild: HTMLElement) {
        this.domContentInnerContainer.insertBefore(domChild, beforeDOMChild);
    }

    removeDOMChild(domChild: HTMLElement) {
        this.domContentInnerContainer.removeChild(domChild);
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

    protected updateDOM() {
        const pageConfig = this.editor.getConfig().getPageConfig();
        const layoutNode = this.layoutNode;
        const domContentContainer = this.domContentContainer;
        domContentContainer.style.width = `${layoutNode.getOuterWidth()}px`;
        if (pageConfig.getShouldTrimPageBottom()) {
            domContentContainer.style.maxHeight = `${layoutNode.getOuterHeight()}px`;
        } else {
            domContentContainer.style.height = `${layoutNode.getOuterHeight()}px`;
        }
        domContentContainer.style.paddingTop = `${layoutNode.getPaddingTop()}px`;
        domContentContainer.style.paddingBottom = `${layoutNode.getPaddingBottom()}px`;
        domContentContainer.style.paddingLeft = `${layoutNode.getPaddingLeft()}px`;
        domContentContainer.style.paddingRight = `${layoutNode.getPaddingRight()}px`;
    }
}
