import DocumentView from './DocumentView';
import LineView from './LineView';

export default class PageView {
  private documentView?: DocumentView;
  private lineViews: LineView[];
  private domElement?: HTMLElement;

  constructor() {
    this.lineViews = [];
  }

  setDocumentView(documentView: DocumentView) {
    this.documentView = documentView;
  }

  appendLineView(lineView: LineView) {
    this.lineViews.push(lineView);
    lineView.setPageView(this);
  }

  removeLineView(lineView: LineView) {
    const index = this.lineViews.indexOf(lineView);
    if (index < 0) {
      return;
    }
    this.lineViews.splice(index, 1);
  }

  addToDOM() {
    if (this.domElement) {
      return;
    }
    const parentDOMElement = this.getDocumentView().getDOMElement();
    this.domElement = document.createElement('div');
    this.domElement.className = 'tw--page';
    this.lineViews.forEach(lineView => lineView.addToDOM());
    parentDOMElement.appendChild(this.domElement);
  }

  getDocumentView(): DocumentView {
    return this.documentView!;
  }

  getDOMElement(): HTMLElement {
    return this.domElement!;
  }
}
