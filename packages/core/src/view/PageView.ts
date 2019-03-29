import PageBox from '../layout/PageBox';
import View from './View';
import BlockView from './BlockView';

type Child = BlockView;

export default class PageView extends View {
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

  onRender(pageBox: PageBox) {
    this.domContainer.style.width = `${pageBox.getWidth()}px`;
    this.domContainer.style.height = `${pageBox.getHeight()}px`;
    this.domContainer.style.padding = `${pageBox.getPadding()}px`;
  }
}
