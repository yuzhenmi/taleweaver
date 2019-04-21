import RootNode from '../tree/RootNode';
import DocBox from '../layout/DocBox';
import ViewNode from './ViewNode';
import PageViewNode from './PageViewNode';

type Child = PageViewNode;

type OnUpdatedSubscriber = () => void;

export default class DocViewNode extends ViewNode implements RootNode {
  protected children: Child[] = [];
  protected domContainer: HTMLDivElement;
  protected onUpdatedSubscribers: OnUpdatedSubscriber[] = [];

  constructor(id: string) {
    super(id);
    this.domContainer = document.createElement('div');
    this.domContainer.contentEditable = 'true';
    this.domContainer.spellcheck = false;
    this.domContainer.className = 'tw--doc';
    this.domContainer.setAttribute('data-tw-id', id);
    this.domContainer.setAttribute('data-tw-role', 'doc');
    this.domContainer.style.outline = 'none';
    this.domContainer.style.textAlign = 'left';
  }

  getDOMContainer(): HTMLDivElement {
    return this.domContainer;
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
    const childDOMContainer = child.getDOMContainer();
    this.domContainer.removeChild(childDOMContainer);
    child.onDeleted();
    child.setParent(null);
    this.children.splice(childOffset, 1);
  }

  getChildren(): Child[] {
    return this.children;
  }

  onLayoutUpdated(layoutNode: DocBox) {
    this.selectableSize = layoutNode.getSelectableSize();
  }

  subscribeOnUpdated(onUpdatedSubscriber: OnUpdatedSubscriber) {
    this.onUpdatedSubscribers.push(onUpdatedSubscriber);
  }

  onUpdated() {
    this.onUpdatedSubscribers.forEach(onUpdatedSubscriber => {
      onUpdatedSubscriber();
    });
  }

  onDeleted() {}

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
