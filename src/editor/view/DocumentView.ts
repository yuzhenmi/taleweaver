import TaleWeaver from '../TaleWeaver';
import DocumentElement from '../element/DocumentElement';
import PageView from './PageView';

export default class DocumentView {
  private documentElement?: DocumentElement;
  private taleWeaver?: TaleWeaver;
  private pageViews: PageView[];
  private domElement?: HTMLElement;

  constructor() {
    this.pageViews = [];
  }

  setDocumentElement(documentElement: DocumentElement) {
    this.documentElement = documentElement;
  }

  setTaleWeaver(taleWeaver: TaleWeaver) {
    this.taleWeaver = taleWeaver;
  }

  appendPageView(pageView: PageView) {
    this.pageViews.push(pageView);
    pageView.setDocumentView(this);
  }

  removePageView(pageView: PageView) {
    const index = this.pageViews.indexOf(pageView);
    if (index < 0) {
      return;
    }
    this.pageViews.splice(index, 1);
  }

  addToDOM(containerDOMElement: HTMLElement) {
    if (this.domElement) {
      return;
    }
    this.domElement = document.createElement('div');
    this.domElement.className = 'tw--document';
    // TODO: Build page views
    this.pageViews.forEach(pageView => pageView.addToDOM());
    containerDOMElement.appendChild(this.domElement);
  }

  getDocumentElement(): DocumentElement {
    return this.documentElement!;
  }

  getTaleWeaver(): TaleWeaver {
    return this.taleWeaver!;
  }

  getDOMElement(): HTMLElement {
    return this.domElement!;
  }
}
