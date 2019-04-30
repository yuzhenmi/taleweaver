import BranchNode from '../tree/BranchNode';
import LineFlowBox from '../layout/LineFlowBox';
import ViewNode from './ViewNode';
import BlockViewNode from './BlockViewNode';
import InlineViewNode from './InlineViewNode';

type Parent = BlockViewNode;
type Child = InlineViewNode;

export default class LineViewNode extends ViewNode implements BranchNode {
  protected parent: Parent | null = null;
  protected children: Child[] = [];
  protected domContainer: HTMLDivElement;

  constructor(id: string) {
    super(id);
    this.domContainer = document.createElement('div');
    this.domContainer.className = 'tw--line';
    this.domContainer.setAttribute('data-tw-id', id);
    this.domContainer.setAttribute('data-tw-role', 'line');
    this.domContainer.style.whiteSpace = 'pre-wrap';
  }

  getDOMContainer(): HTMLDivElement {
    return this.domContainer;
  }

  getDOMContentContainer(): HTMLDivElement {
    return this.domContainer;
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
      this.domContainer.appendChild(childDOMContainer);
    } else {
      this.children.splice(offset, 0, child);
      if (offset > this.domContainer.childNodes.length) {
        throw new Error(`Error inserting child to view, offset ${offset} is out of range.`);
      }
      if (offset === this.domContainer.childNodes.length) {
        this.domContainer.appendChild(childDOMContainer);
      } else {
        this.domContainer.insertBefore(childDOMContainer, this.domContainer.childNodes[offset]);
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
    this.domContainer.removeChild(childDOMContainer);
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

  onLayoutUpdated(layoutNode: LineFlowBox) {
    this.selectableSize = layoutNode.getSelectableSize();
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
