import DocumentView from './DocumentView';
import LineView, { LineViewScreenPosition } from './LineView';

type PageViewConfig = {
  width: number;
  height: number;
  paddingTop: number;
  paddingBottom: number;
  paddingLeft: number;
  paddingRight: number;
}

export type PageViewScreenPositions = {
  left: number;
  width: number;
  top: number;
  height: number;
}[]

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
    this.domElement.style.position = 'relative';
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

  getSize(): number {
    let size = 0;
    this.lineViews!.forEach(lineView => size += lineView.getSize());
    return size;
  }

  getScreenPositions(from: number, to: number): PageViewScreenPositions {
    let cumulatedSize = 0;
    let cumulatedHeight = 0;
    const screenPositions: PageViewScreenPositions = [];
    for (let n = 0, nn = this.lineViews.length; n < nn; n++) {
      const lineView = this.lineViews[n];
      const lineViewSize = lineView.getSize();
      if (from - cumulatedSize < lineViewSize) {
        const lineViewScreenPosition = lineView.getScreenPosition(from - cumulatedSize, Math.min(to - cumulatedSize, lineViewSize));
        screenPositions.push({
          left: lineViewScreenPosition.left,
          width: lineViewScreenPosition.width,
          top: cumulatedHeight,
          height: lineViewScreenPosition.height,
        });
      }
      cumulatedSize += lineViewSize;
      cumulatedHeight += lineView.getHeight();
      if (to <= cumulatedSize) {
        return screenPositions;
      }
    }
    throw new Error(`Page screen positions cannot be determined for range from ${from} to ${to}.`);
  }
}
