import PageFlowBox from '../layout/PageFlowBox';
import ViewNode from './ViewNode';
import BlockViewNode from './BlockViewNode';

type Child = BlockViewNode;

export default class PageViewNode extends ViewNode {
  protected children: Child[];
  protected domContainer: HTMLDivElement;

  constructor(id: string) {
    super(id);
    this.children = [];
    this.domContainer = document.createElement('div');
    this.domContainer.className = 'tw--page';
    this.domContainer.style.whiteSpace = 'pre';
  }

  getDOMContainer(): HTMLDivElement {
    return this.domContainer;
  }

  getDOMContentContainer(): HTMLDivElement {
    return this.domContainer;
  }

  insertChild(child: Child, offset: number) {
    this.children.splice(offset, 0, child);
    const childDOMContainer = child.getDOMContainer();
    if (offset > this.domContainer.childNodes.length) {
      throw new Error(`Error inserting child to view, offset ${offset} is out of range.`);
    }
    if (offset === this.domContainer.childNodes.length) {
      this.domContainer.appendChild(childDOMContainer);
    } else {
      this.domContainer.insertBefore(childDOMContainer, this.domContainer.childNodes[offset + 1]);
    }
    this.domContainer.appendChild(childDOMContainer);
  }

  deleteChild(child: Child) {
    const childOffset = this.children.indexOf(child);
    if (childOffset < 0) {
      throw new Error('Cannot delete child, child not found.');
    }
    this.children.splice(childOffset, 1);
    const childDOMContainer = child.getDOMContainer();
    this.domContainer.removeChild(childDOMContainer);
  }

  getChildren(): Child[] {
    return this.children;
  }

  onLayoutUpdated(layoutNode: PageFlowBox) {
    this.domContainer.style.width = `${layoutNode.getWidth()}px`;
    this.domContainer.style.height = `${layoutNode.getHeight()}px`;
    this.domContainer.style.padding = `${layoutNode.getPadding()}px`;
  }
}
