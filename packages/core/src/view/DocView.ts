import DocBox from '../layout/DocBox';
import View from './View';
import PageView from './PageView';

export default class DocView extends View {
  protected docBox: DocBox;
  protected children: PageView[];
  protected domContainer: HTMLDivElement;

  constructor(docBox: DocBox) {
    super();
    this.docBox = docBox;
    this.children = [];
    this.domContainer = document.createElement('div');
    this.domContainer.className = 'tw--doc';
    this.domContainer.style.whiteSpace = 'pre';
  }

  getDOMContainer(): HTMLDivElement {
    return this.domContainer;
  }

  insertChild(child: PageView, offset: number) {
    this.children.push(child);
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

  getChildren(): PageView[] {
    return this.children;
  }
}
