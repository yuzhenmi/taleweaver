import DocumentView from './DocumentView';
import LineView from './LineView';

type PageViewConfig = {
  width: number;
  height: number;
  paddingTop: number;
  paddingBottom: number;
  paddingLeft: number;
  paddingRight: number;
}

export default class PageView {
  private config: PageViewConfig;
  private documentView?: DocumentView;
  private lineViews: LineView[];
  private domElement?: HTMLElement;

  constructor(config: PageViewConfig) {
    this.config = config;
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
    this.domElement.style.width = `${this.config.width}px`;
    this.domElement.style.height = `${this.config.height}px`;
    this.domElement.style.padding = `${this.config.paddingTop}px ${this.config.paddingRight}px ${this.config.paddingBottom}px ${this.config.paddingLeft}px`;
    this.lineViews.forEach(lineView => lineView.addToDOM());
    parentDOMElement.appendChild(this.domElement);
  }

  getConfig(): PageViewConfig {
    return this.config;
  }

  getDocumentView(): DocumentView {
    return this.documentView!;
  }

  getDOMElement(): HTMLElement {
    return this.domElement!;
  }
}
