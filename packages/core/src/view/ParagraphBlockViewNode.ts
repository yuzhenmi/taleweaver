import Editor from '../Editor';
import ParagraphBlockBox from '../layout/ParagraphLayoutNode';
import BlockViewNode, { Child } from './BlockViewNode';

export default class ParagraphBlockViewNode extends BlockViewNode {
  protected domContainer: HTMLDivElement;

  constructor(editor: Editor, id: string) {
    super(editor, id);
    this.domContainer = document.createElement('div');
    this.domContainer.className = 'tw--paragraph-block';
    this.domContainer.setAttribute('data-tw-id', id);
    this.domContainer.setAttribute('data-tw-role', 'block');
  }

  getDOMContainer() {
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
    child.onDeleted();
    const childDOMContainer = child.getDOMContainer();
    this.domContainer.removeChild(childDOMContainer);
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

  onLayoutUpdated(layoutNode: ParagraphBlockBox) {
    this.selectableSize = layoutNode.getSelectableSize();
    this.domContainer.style.width = `${layoutNode.getWidth()}px`;
    this.domContainer.style.height = `${layoutNode.getHeight()}px`;
    this.domContainer.style.paddingTop = `${layoutNode.getPaddingTop()}px`;
    this.domContainer.style.paddingBottom = `${layoutNode.getPaddingBottom()}px`;
    this.domContainer.style.paddingLeft = `${layoutNode.getPaddingLeft()}px`;
    this.domContainer.style.paddingRight = `${layoutNode.getPaddingRight()}px`;
  }
}
