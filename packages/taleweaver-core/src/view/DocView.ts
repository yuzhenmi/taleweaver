import DocLayout from '../layout/DocLayout';
import View from './View';
import PageView from './PageView';

export default class DocView extends View {
  protected docLayout: DocLayout;
  protected domContainer: HTMLDivElement;

  constructor(docLayout: DocLayout) {
    super();
    this.docLayout = docLayout;
    this.domContainer = document.createElement('div');
    this.domContainer.className = 'tw--doc';
  }

  getDOMContainer(): HTMLDivElement {
    return this.domContainer;
  }

  insertChild(child: PageView, offset: number) {
    const childDOMContainer = child.getDOMContainer();
    if (offset > this.domContainer.childNodes.length) {
      throw new Error(`Error inserting child to doc view, offset ${offset} is out of range.`);
    }
    if (offset === this.domContainer.childNodes.length) {
      this.domContainer.appendChild(childDOMContainer);
    } else {
      this.domContainer.insertBefore(childDOMContainer, this.domContainer.childNodes[offset + 1]);
    }
    this.domContainer.appendChild(childDOMContainer);
  }
}
