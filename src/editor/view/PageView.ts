import DocumentView from './DocumentView';
import LineView from './LineView';
import EventHandler from './helpers/EventHandler';

type PageViewConfig = {
  width: number;
  height: number;
  paddingTop: number;
  paddingBottom: number;
  paddingLeft: number;
  paddingRight: number;
};

type EventHandlers = {
  onPointerDown: EventHandler,
  onPointerUp: EventHandler,
};

export type PageViewScreenPositions = {
  left: number;
  width: number;
  top: number;
  height: number;
}[];

export default class PageView {
  private documentView: DocumentView;
  private eventHandlers: EventHandlers;
  private config: PageViewConfig;
  private lineViews: LineView[];
  private domElement?: HTMLElement;

  constructor(documentView: DocumentView, eventHandlers: EventHandlers, config: PageViewConfig) {
    this.documentView = documentView;
    this.eventHandlers = eventHandlers;
    this.config = config;
    this.lineViews = [];
  }

  getDocumentView(): DocumentView {
    return this.documentView!;
  }

  getConfig(): PageViewConfig {
    return this.config;
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

  getSize(): number {
    let size = 0;
    this.lineViews!.forEach(lineView => size += lineView.getSize());
    return size;
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
    this.domElement.style.userSelect = 'none';
    this.domElement.addEventListener('selectstart', this.handleSelectStart);
    this.domElement.addEventListener('click', this.handleClick);
    this.lineViews.forEach(lineView => lineView.addToDOM());
    parentDOMElement.appendChild(this.domElement);
  }

  getDOMElement(): HTMLElement {
    return this.domElement!;
  }

  private handleSelectStart = (event: Event) => {
    event.preventDefault();
  }

  private handleClick = (event: MouseEvent) => {
    const left = Math.min(this.config.width, Math.max(0, event.pageX - this.domElement!.offsetLeft - this.config.paddingLeft));
    const top = Math.min(this.config.height, Math.max(0, event.pageY - this.domElement!.offsetTop - this.config.paddingTop));
    let cumulatedHeight = 0;
    let cumulatedSize = 0;
    let lineView: LineView;
    for (let n = 0, nn = this.lineViews.length; n < nn; n++) {
      lineView = this.lineViews[n];
      const lineViewHeight = lineView.getHeight();
      if (cumulatedHeight + lineViewHeight > top) {
        break;
      }
      cumulatedHeight += lineViewHeight;
      cumulatedSize += lineView.getSize();
    }
    const boxViews = lineView!.getBoxViews();
    let cumulatedWidth = 0;
    let boxView;
    for (let n = 0, nn = boxViews.length; n < nn; n++) {
      boxView = boxViews[n];
      const boxViewWidth = boxView.getWidth();
      if (cumulatedWidth + boxViewWidth > left) {
        break;
      }
      cumulatedWidth += boxViewWidth;
      cumulatedSize += boxView.getSize();
    }
    const position = cumulatedSize;
    this.eventHandlers.onPointerDown({
      pageView: this,
      pageViewPosition: position,
    });
    this.eventHandlers.onPointerUp({
      pageView: this,
      pageViewPosition: position,
    });
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
