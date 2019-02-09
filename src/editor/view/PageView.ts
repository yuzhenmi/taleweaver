import throttle from '../helpers/throttle';
import DocumentView from './DocumentView';
import LineView from './LineView';
import WordView from './WordView';

export type PageViewConfig = {
  width: number;
  height: number;
  paddingTop: number;
  paddingBottom: number;
  paddingLeft: number;
  paddingRight: number;
};

export type PageViewPointerEventHandler = (event: PageViewPointerEvent) => void;
export type PageViewPointerEvent = {
  pageView: PageView;
  pageViewPosition: number;
}
export type EventHandlers = {
  onPointerDown: PageViewPointerEventHandler,
  onPointerMove: PageViewPointerEventHandler,
  onPointerUp: PageViewPointerEventHandler,
};

export type PageViewScreenSelection = {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
}[];

export default class PageView {
  private documentView: DocumentView;
  private eventHandlers: EventHandlers;
  private config: PageViewConfig;
  private lineViews: LineView[];
  private domElement?: HTMLElement;
  private contentDOMElement?: HTMLElement;

  constructor(documentView: DocumentView, eventHandlers: EventHandlers, config: PageViewConfig) {
    this.documentView = documentView;
    this.eventHandlers = eventHandlers;
    this.config = config;
    this.lineViews = [];
  }

  /**
   * Maps screen position to document position.
   */
  private resolveScreenPosition(x: number, y: number): number {
    // Map DOM document coordinates to relative coordinates
    // within the page's viewport
    const leftMin = 0;
    const leftMax = this.config.width - this.config.paddingLeft - this.config.paddingRight;
    const topMin = 0;
    const topMax = this.config.height - this.config.paddingTop - this.config.paddingBottom;
    const left = Math.min(leftMax, Math.max(leftMin, x - this.domElement!.offsetLeft - this.config.paddingLeft));
    const top = Math.min(topMax, Math.max(topMin, y - this.domElement!.offsetTop - this.config.paddingTop));

    // Step through line views until we reach the line view
    // that contains the screen position
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

    // If left is 0, just return since there is no
    // need to step through boxes
    if (left === 0) {
      return cumulatedSize;
    }

    // Step through box views of the line view until
    // we reach the box view that contains the screen
    // position
    const wordViews = lineView!.getWordViews();
    let cumulatedWidth = 0;
    let wordView: WordView;
    let n = 0;
    for (let nn = wordViews.length; n < nn; n++) {
      wordView = wordViews[n];
      const wordViewWidth = wordView.getWidth();
      if (cumulatedWidth + wordViewWidth >= left) {
        break;
      }
      cumulatedWidth += wordViewWidth;
      cumulatedSize += wordView.getSize();
    }
    if (n  === wordViews.length) {
      // If all boxes were stepped through, i.e. end
      // of line is reached, return cumulated size
      if (cumulatedWidth > 0) {
        return cumulatedSize - 1;
      }
      return cumulatedSize;
    }

    // Step through the box view's content until
    // we reach the document position that corresponds
    // to the screen position
    cumulatedSize += wordView!.getDocumentPosition(left - cumulatedWidth);

    return cumulatedSize;
  }

  /**
   * Handles selectstart DOM event.
   */
  private handleSelectStart = (event: Event) => {
    // Disable browser select functionality
    event.preventDefault();
  }

  /**
   * Handles mouse down DOM event.
   */
  private handleMouseDown = (event: MouseEvent) => {
    const position = this.resolveScreenPosition(event.pageX, event.pageY);
    this.eventHandlers.onPointerDown({
      pageView: this,
      pageViewPosition: position,
    });
  }

  /**
   * Handles mouse move DOM event.
   */
  private handleMouseMove = throttle((event: MouseEvent) => {
    const position = this.resolveScreenPosition(event.pageX, event.pageY);
    this.eventHandlers.onPointerMove({
      pageView: this,
      pageViewPosition: position,
    });
  }, 5)

  /**
   * Handles mouse up DOM event.
   */
  private handleMouseUp = (event: MouseEvent) => {
    const position = this.resolveScreenPosition(event.pageX, event.pageY);
    this.eventHandlers.onPointerUp({
      pageView: this,
      pageViewPosition: position,
    });
  }

  /**
   * Gets the parent document view.
   */
  getDocumentView(): DocumentView {
    return this.documentView!;
  }

  /**
   * Gets the previous page view in the parent document view.
   */
  getPreviousPageView(): PageView | null {
    const pageViews = this.documentView!.getPageViews();
    const index = pageViews.indexOf(this);
    if (index < 0) {
      return null;
    }
    if (index === 0) {
      return null;
    }
    return pageViews[index - 1];
  }

  /**
   * Gets the next page view in the parent document view.
   */
  getNextPageView(): PageView | null {
    const pageViews = this.documentView!.getPageViews();
    const index = pageViews.indexOf(this);
    if (index < 0) {
      return null;
    }
    if (index === pageViews.length - 1) {
      return null;
    }
    return pageViews[index + 1];
  }

  /**
   * Gets config of the page view.
   */
  getConfig(): PageViewConfig {
    return this.config;
  }

  /**
   * Appends a line view to the page.
   */
  appendLineView(lineView: LineView) {
    this.lineViews.push(lineView);
    lineView.setPageView(this);
  }

  /**
   * Remove a line view from the page.
   */
  removeLineView(lineView: LineView) {
    const index = this.lineViews.indexOf(lineView);
    if (index < 0) {
      return;
    }
    this.lineViews.splice(index, 1);
  }

  /**
   * Gets line views in the page.
   */
  getLineViews(): LineView[] {
    return this.lineViews;
  }

  /**
   * Gets the document size covered by this page.
   */
  getSize(): number {
    let size = 0;
    this.lineViews!.forEach(lineView => size += lineView.getSize());
    return size;
  }

  /**
   * Initializes the page DOM element by creating it and appending
   * it to the document. No-op if DOM element is already initialized.
   */
  bindToDOM() {
    // Skip if already bound to DOM
    if (this.domElement) {
      return;
    }

    // Build wrapper element
    this.domElement = document.createElement('div');
    this.domElement.className = 'tw--page';
    this.domElement.style.width = `${this.config.width}px`;
    this.domElement.style.height = `${this.config.height}px`;
    this.domElement.style.padding = `${this.config.paddingTop}px ${this.config.paddingRight}px ${this.config.paddingBottom}px ${this.config.paddingLeft}px`;
    this.domElement.style.userSelect = 'none';
    const parentDOMElement = this.getDocumentView().getDOMElement();
    parentDOMElement.appendChild(this.domElement);

    // Build content element
    this.contentDOMElement = document.createElement('div');
    this.contentDOMElement.className = 'tw--page-content';
    this.contentDOMElement.style.position = 'relative';
    this.contentDOMElement.style.height = '100%';
    this.domElement.appendChild(this.contentDOMElement);

    // Attach event listeners
    this.domElement.addEventListener('selectstart', this.handleSelectStart);
    this.domElement.addEventListener('mousedown', this.handleMouseDown);
    this.domElement.addEventListener('mousemove', this.handleMouseMove);
    this.domElement.addEventListener('mouseup', this.handleMouseUp);

    // Render line views
    this.lineViews.forEach(lineView => lineView.bindToDOM());
  }

  /**
   * Gets the page DOM element.
   */
  getDOMElement(): HTMLElement {
    return this.domElement!;
  }

  /**
   * Gets the page content DOM element.
   */
  getContentDOMElement(): HTMLElement {
    return this.contentDOMElement!;
  }

  /**
   * Gets the screen selection by document position range.
   * @param from - From document position.
   * @param to - To document position.
   */
  getScreenSelection(from: number, to: number): PageViewScreenSelection {
    if (from < 0 || from > this.getSize()) {
      throw new Error(`Page position out of bound: ${from}.`);
    }
    if (to < 0 || to > this.getSize()) {
      throw new Error(`Page position out of bound: ${to}.`);
    }
    if (from > to) {
      throw new Error('Page from position cannot be greater than to position.');
    }
    let currentPosition = this.getSize();
    if (from >= currentPosition || to >= currentPosition) {
      throw new Error(`Page screen positions cannot be determined for range from ${from} to ${to}.`);
    }
    const screenSelection: PageViewScreenSelection = [];
    for (let n = this.lineViews.length - 1; n >= 0; n--) {
      const lineView = this.lineViews[n];
      currentPosition -= lineView.getSize();
      if (currentPosition <= to) {
        const lineFrom = Math.max(from - currentPosition, 0);
        const lineTo = Math.min(to - currentPosition, lineView.getSize() - 1);
        const lineViewScreenSelection = lineView.getScreenSelection(lineFrom, lineTo);
        const y1 = this.lineViews.slice(0, n).reduce((height, line) => height + line.getHeight(), 0);
        screenSelection.push({
          x1: lineViewScreenSelection.x1,
          x2: lineViewScreenSelection.x2,
          y1,
          y2: y1 + lineViewScreenSelection.height,
        });
      }
      if (currentPosition <= from) {
        return screenSelection;
      }
    }
    throw new Error(`Page screen positions cannot be determined for range from ${from} to ${to}.`);
  }
}
