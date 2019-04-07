import PageFlowBox from '../layout/PageFlowBox';
import ViewNode from './ViewNode';
import BlockViewNode from './BlockViewNode';

type Child = BlockViewNode;

export default class PageViewNode extends ViewNode {
  protected children: Child[];
  protected domContainer: HTMLDivElement;
  protected domContentContainer: HTMLDivElement;

  constructor(id: string) {
    super(id);
    this.children = [];
    this.domContainer = document.createElement('div');
    this.domContainer.className = 'tw--page';
    this.domContainer.setAttribute('data-tw-role', 'page');
    this.domContainer.style.position = 'relative';
    this.domContentContainer = document.createElement('div');
    this.domContentContainer.className = 'tw--page-content';
    this.domContentContainer.setAttribute('data-tw-role', 'page-content');
    this.domContainer.appendChild(this.domContentContainer);
  }

  getDOMContainer(): HTMLDivElement {
    return this.domContainer;
  }

  getDOMContentContainer(): HTMLDivElement {
    return this.domContentContainer;
  }

  insertChild(child: Child, offset: number) {
    this.children.splice(offset, 0, child);
    const childDOMContainer = child.getDOMContainer();
    if (offset > this.domContentContainer.childNodes.length) {
      throw new Error(`Error inserting child to view, offset ${offset} is out of range.`);
    }
    if (offset === this.domContentContainer.childNodes.length) {
      this.domContentContainer.appendChild(childDOMContainer);
    } else {
      this.domContentContainer.insertBefore(childDOMContainer, this.domContentContainer.childNodes[offset]);
    }
  }

  deleteChild(child: Child) {
    const childOffset = this.children.indexOf(child);
    if (childOffset < 0) {
      throw new Error('Cannot delete child, child not found.');
    }
    child.onDeleted();
    this.children.splice(childOffset, 1);
  }

  getChildren(): Child[] {
    return this.children;
  }

  onDeleted() {
    if (this.domContainer.parentElement) {
      this.domContainer.parentElement.removeChild(this.domContainer);
    }
    this.children.map(child => {
      child.onDeleted();
    });
  }

  onLayoutUpdated(layoutNode: PageFlowBox) {
    this.domContainer.style.width = `${layoutNode.getWidth()}px`;
    this.domContainer.style.height = `${layoutNode.getHeight()}px`;
    this.domContainer.style.padding = `${layoutNode.getPadding()}px`;
  }
}
