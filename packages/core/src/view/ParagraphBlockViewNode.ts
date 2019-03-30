import ParagraphBlockBox from '../layout/ParagraphBlockBox';
import BlockViewNode, { Child } from './BlockViewNode';

export default class ParagraphBlockViewNode extends BlockViewNode {
  protected children: Child[];
  protected domContainer: HTMLDivElement;

  constructor(id: string) {
    super(id);
    this.children = [];
    this.domContainer = document.createElement('div');
    this.domContainer.className = 'tw--paragraph-block';
    this.domContainer.style.whiteSpace = 'pre';
  }

  getDOMContainer(): HTMLDivElement {
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
    child.onDeleted();
    this.children.splice(childOffset, 1);
  }

  getChildren(): Child[] {
    return this.children;
  }

  onDeleted() {
    this.children.map(child => {
      child.onDeleted();
    });
    if (this.domContainer.parentElement) {
      this.domContainer.parentElement.removeChild(this.domContainer);
    }
  }

  onLayoutUpdated(layoutNode: ParagraphBlockBox) {}
}
