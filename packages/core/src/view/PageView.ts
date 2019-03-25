import PageBox from '../layout/PageBox';
import View from './View';
import BlockView from './BlockView';

export default class PageView extends View {
  protected pageBox: PageBox;
  protected domContainer: HTMLDivElement;

  constructor(pageBox: PageBox) {
    super();
    this.pageBox = pageBox;
    this.domContainer = document.createElement('div');
    this.domContainer.className = 'tw--page';
    this.domContainer.style.whiteSpace = 'pre';
    this.domContainer.style.width = `${pageBox.getWidth()}px`;
    this.domContainer.style.height = `${pageBox.getHeight()}px`;
    this.domContainer.style.padding = `${pageBox.getPadding()}px`;
  }

  getDOMContainer(): HTMLDivElement {
    return this.domContainer;
  }

  getDOMContentContainer(): HTMLDivElement {
    return this.domContainer;
  }

  insertChild(child: BlockView, offset: number) {
    const childDOMContainer = child.getDOMContainer();
    if (offset > this.domContainer.childNodes.length) {
      throw new Error(`Error inserting child to page view, offset ${offset} is out of range.`);
    }
    if (offset === this.domContainer.childNodes.length) {
      this.domContainer.appendChild(childDOMContainer);
    } else {
      this.domContainer.insertBefore(childDOMContainer, this.domContainer.childNodes[offset + 1]);
    }
    this.domContainer.appendChild(childDOMContainer);
  }
}
