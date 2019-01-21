import DocumentView from './DocumentView';
import BlockView from './BlockView';

export default class PageView {
  private documentView?: DocumentView;
  private blockViews: BlockView[];
  private domElement?: HTMLElement;

  constructor() {
    this.blockViews = [];
  }

  setDocumentView(documentView: DocumentView) {
    this.documentView = documentView;
  }

  appendBlockView(blockView: BlockView) {
    this.blockViews.push(blockView);
    blockView.setPageView(this);
  }

  removeBlockView(blockView: BlockView) {
    const index = this.blockViews.indexOf(blockView);
    if (index < 0) {
      return;
    }
    this.blockViews.splice(index, 1);
  }

  addToDOM() {
    if (this.domElement) {
      return;
    }
    const parentDOMElement = this.getDocumentView().getDOMElement();
    this.domElement = document.createElement('div');
    this.domElement.className = 'tw--page';
    this.blockViews.forEach(blockView => blockView.addToDOM());
    parentDOMElement.appendChild(this.domElement);
  }

  getDocumentView(): DocumentView {
    return this.documentView!;
  }

  getDOMElement(): HTMLElement {
    return this.domElement!;
  }
}
