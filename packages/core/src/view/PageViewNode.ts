import Editor from '../Editor';
import BranchNode from '../tree/BranchNode';
import PageFlowBox from '../layout/PageFlowBox';
import ViewNode from './ViewNode';
import DocViewNode from './DocViewNode';
import BlockViewNode from './BlockViewNode';

type Parent = DocViewNode;
type Child = BlockViewNode;

export default class PageViewNode extends ViewNode implements BranchNode {
  protected parent: Parent | null = null;
  protected children: Child[] = [];
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

  getDOMContainer() {
    return this.domContainer;
  }

  getDOMContentContainer() {
    return this.domContentContainer;
  }

  getDOMContentInnerContainer() {
    return this.domContentInnerContainer;
  }

  setParent(parent: Parent | null) {
    this.parent = parent;
  }

  getParent() {
    if (!this.parent) {
      throw new Error(`No parent has been set.`);
    }
    return this.parent;
  }

  insertChild(child: Child, offset: number | null = null) {
    const childDOMContainer = child.getDOMContainer();
    child.setParent(this);
    if (offset === null) {
      this.children.push(child);
      this.domContentInnerContainer.appendChild(childDOMContainer);
    } else {
      this.children.splice(offset, 0, child);
      if (offset > this.domContentInnerContainer.childNodes.length) {
        throw new Error(`Error inserting child to view, offset ${offset} is out of range.`);
      }
      if (offset === this.domContentInnerContainer.childNodes.length) {
        this.domContentInnerContainer.appendChild(childDOMContainer);
      } else {
        this.domContentInnerContainer.insertBefore(childDOMContainer, this.domContentInnerContainer.childNodes[offset]);
      }
    }
  }

  deleteChild(child: Child) {
    const childOffset = this.children.indexOf(child);
    if (childOffset < 0) {
      throw new Error('Cannot delete child, child not found.');
    }
    child.onDeleted();
    const childDOMContainer = child.getDOMContainer();
    this.domContentInnerContainer.removeChild(childDOMContainer);
    child.setParent(null);
    this.children.splice(childOffset, 1);
  }

  getChildren() {
    return this.children;
  }

  onDeleted() {
    this.children.map(child => {
      child.onDeleted();
    });
  }

  onLayoutUpdated(layoutNode: PageFlowBox) {
    const pageConfig = this.editor.getConfig().getPageConfig();
    this.size = layoutNode.getSize();
    this.domContentContainer.style.width = `${layoutNode.getWidth()}px`;
    if (pageConfig.getShouldTrimPageBottom()) {
      this.domContentContainer.style.maxHeight = `${layoutNode.getHeight()}px`;
    } else {
      this.domContentContainer.style.height = `${layoutNode.getHeight()}px`;
    }
    this.domContentContainer.style.paddingTop = `${layoutNode.getPaddingTop()}px`;
    this.domContentContainer.style.paddingBottom = `${layoutNode.getPaddingBottom()}px`;
    this.domContentContainer.style.paddingLeft = `${layoutNode.getPaddingLeft()}px`;
    this.domContentContainer.style.paddingRight = `${layoutNode.getPaddingRight()}px`;
  }
}
