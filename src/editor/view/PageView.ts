import throttle from '../helpers/throttle';
import DocumentView from './DocumentView';
import LineView from './LineView';
import BoxView from './BoxView';

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
    const boxViews = lineView!.getBoxViews();
    let cumulatedWidth = 0;
    let boxView: BoxView;
    let n = 0;
    for (let nn = boxViews.length; n < nn; n++) {
      boxView = boxViews[n];
      const boxViewWidth = boxView.getWidth();
      if (cumulatedWidth + boxViewWidth >= left) {
        break;
      }
      cumulatedWidth += boxViewWidth;
      cumulatedSize += boxView.getSize();
    }
    if (n  === boxViews.length) {
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
    cumulatedSize += boxView!.getDocumentPosition(left - cumulatedWidth);

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
    this.domElement.addEventListener('mousedown', this.handleMouseDown);
    this.domElement.addEventListener('mousemove', this.handleMouseMove);
    this.domElement.addEventListener('mouseup', this.handleMouseUp);
    this.lineViews.forEach(lineView => lineView.bindToDOM());
    parentDOMElement.appendChild(this.domElement);
  }

  /**
   * Gets the page DOM element.
   */
  getDOMElement(): HTMLElement {
    return this.domElement!;
  }

  /**
   * Gets page screen positions for a slice of the document.
   */
  getScreenPositions(from: number, to: number): PageViewScreenPositions {
    let cumulatedSize = 0;
    let cumulatedHeight = 0;
    const screenPositions: PageViewScreenPositions = [];
    for (let n = 0, nn = this.lineViews.length; n < nn; n++) {
      const lineView = this.lineViews[n];
      const lineViewSize = lineView.getSize();
      if (cumulatedSize + lineViewSize >= from) {
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
      if (cumulatedSize >= to) {
        return screenPositions;
      }
    }
    throw new Error(`Page screen positions cannot be determined for range from ${from} to ${to}.`);
  }
}
