import Editor from '../Editor';
import RootNode from '../tree/RootNode';
import DocBox from '../layout/DocBox';
import ViewNode from './ViewNode';
import PageViewNode from './PageViewNode';

type Child = PageViewNode;

export default class DocViewNode extends ViewNode implements RootNode {
  protected children: Child[] = [];
  protected domContainer: HTMLDivElement;

  constructor(editor: Editor, id: string) {
    super(editor, id);
    this.domContainer = document.createElement('div');
    this.domContainer.className = 'tw--doc';
    this.domContainer.setAttribute('data-tw-instance', editor.getID());
    this.domContainer.setAttribute('data-tw-id', id);
    this.domContainer.setAttribute('data-tw-role', 'doc');
    this.domContainer.style.textAlign = 'left';
    this.domContainer.style.cursor = 'text';
    this.domContainer.style.userSelect = 'none';
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
    const childDOMContainer = child.getDOMContainer();
    this.domContainer.removeChild(childDOMContainer);
    child.onDeleted();
    child.setParent(null);
    this.children.splice(childOffset, 1);
  }

  getChildren() {
    return this.children;
  }

  onLayoutUpdated(layoutNode: DocBox) {
    this.size = layoutNode.getSize();
  }

  onDeleted() {}
}
