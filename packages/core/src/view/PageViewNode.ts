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

  constructor(id: string) {
    super(id);
    this.domContainer = document.createElement('div');
    this.domContainer.className = 'tw--page';
    this.domContainer.setAttribute('data-tw-id', id);
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

  setParent(parent: Parent | null) {
    this.parent = parent;
  }

  getParent(): Parent {
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
      this.domContentContainer.appendChild(childDOMContainer);
    } else {
      this.children.splice(offset, 0, child);
      if (offset > this.domContentContainer.childNodes.length) {
        throw new Error(`Error inserting child to view, offset ${offset} is out of range.`);
      }
      if (offset === this.domContentContainer.childNodes.length) {
        this.domContentContainer.appendChild(childDOMContainer);
      } else {
        this.domContentContainer.insertBefore(childDOMContainer, this.domContentContainer.childNodes[offset]);
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
    this.domContentContainer.removeChild(childDOMContainer);
    child.setParent(null);
    this.children.splice(childOffset, 1);
  }

  getChildren(): Child[] {
    return this.children;
  }

  onDeleted() {
    this.children.map(child => {
      child.onDeleted();
    });
  }

  onLayoutUpdated(layoutNode: PageFlowBox) {
    this.selectableSize = layoutNode.getSelectableSize();
    this.domContainer.style.width = `${layoutNode.getWidth()}px`;
    this.domContainer.style.height = `${layoutNode.getHeight()}px`;
    this.domContainer.style.padding = `${layoutNode.getPadding()}px`;
  }

  resolveSelectableOffsetToNodeOffset(offset: number): [Node, number] {
    let cumulatedOffset = 0;
    for (let n = 0, nn = this.children.length; n < nn; n++) {
      const child = this.children[n];
      if (cumulatedOffset + child.getSelectableSize() > offset) {
        return child.resolveSelectableOffsetToNodeOffset(offset - cumulatedOffset);
      }
      cumulatedOffset += child.getSelectableSize();
    }
    throw new Error(`Selectable offset ${offset} is out of range.`);
  }
}
