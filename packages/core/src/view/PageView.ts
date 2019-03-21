import PageLayout from '../layout/PageLayout';
import View from './View';
import BlockView from './BlockView';

export default class PageView extends View {
  protected pageLayout: PageLayout;
  protected domContainer: HTMLDivElement;

  constructor(pageLayout: PageLayout) {
    super();
    this.pageLayout = pageLayout;
    this.domContainer = document.createElement('div');
    this.domContainer.className = 'tw--page';
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
