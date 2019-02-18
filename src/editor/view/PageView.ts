import DocView from './DocView';
import LineView, { LineViewAwarePosition } from './LineView';

/**
 * Page view configs.
 */
export interface PageViewConfig {
  width: number;
  height: number;
  paddingTop: number;
  paddingBottom: number;
  paddingLeft: number;
  paddingRight: number;
}

export interface PageViewDOMElements {
  domPage: HTMLDivElement;
  domPageContent: HTMLDivElement;
}

export interface PageViewPositionBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface PageViewAwarePosition extends LineViewAwarePosition {
  pageView: PageView;
  pageViewPosition: number;
};

export default class PageView {
  private docView: DocView;
  private config: PageViewConfig;

  private lineViews: LineView[];

  private mounted: boolean;
  private domPage?: HTMLDivElement;
  private domPageContent?: HTMLDivElement;

  constructor(docView: DocView, config: PageViewConfig) {
    this.docView = docView;
    this.config = config;

    this.lineViews = [];

    this.mounted = false;
  }

  /**
   * Gets the model size of the page.
   */
  getSize(): number {
    let size = 0;
    this.lineViews!.forEach(lineView => size += lineView.getSize());
    return size;
  }

  /**
   * Gets the parent document view.
   */
  getDocView(): DocView {
    return this.docView!;
  }

  /**
   * Gets the previous page view in the parent document view.
   */
  getPreviousPageView(): PageView | null {
    const pageViews = this.docView!.getPageViews();
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
    const pageViews = this.docView!.getPageViews();
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
   * Gets the child line views.
   */
  getLineViews(): LineView[] {
    return this.lineViews;
  }

  /**
   * Mounts the view to DOM.
   */
  mount() {
    // Do not mount if already mounted
    if (this.mounted) {
      return;
    }

    // Get wrapper element
    const { domDocumentContent } = this.docView.getDOM();

    // Build page element
    this.domPage = document.createElement('div');
    this.domPage.className = 'tw--page';
    this.domPage.style.width = `${this.config.width}px`;
    this.domPage.style.height = `${this.config.height}px`;
    this.domPage.style.padding = `${this.config.paddingTop}px ${this.config.paddingRight}px ${this.config.paddingBottom}px ${this.config.paddingLeft}px`;
    this.domPage.style.userSelect = 'none';
    this.domPage.style.position = 'relative';
    domDocumentContent.appendChild(this.domPage);

    // Build page content element
    this.domPageContent = document.createElement('div');
    this.domPageContent.className = 'tw--page-content';
    this.domPageContent.style.position = 'relative';
    this.domPageContent.style.height = '100%';
    this.domPage.appendChild(this.domPageContent);

    // Mount line views
    this.lineViews.forEach(lineView => lineView.mount());
  }

  /**
   * Gets DOM elements mounted by the view.
   */
  getDOM(): PageViewDOMElements {
    return {
      domPage: this.domPage!,
      domPageContent: this.domPageContent!,
    };
  }

  /**
   * Gets the height of the view.
   */
  getHeight(): number {
    return this.config.height;
  }

  /**
   * Maps a model position range to view position boxes.
   * @param from - Left-bound of the model position range.
   * @param to - Right-bound of the model position range.
   */
  mapModelPositionRangeToViewPositionBoxes(from: number, to: number): PageViewPositionBox[] {
    // Iterate through lines to break up model position range
    const viewPositionBoxes: PageViewPositionBox[] = [];
    let offset = 0;
    let cumulatedHeight = 0;
    for (let n = 0, nn = this.lineViews.length; n < nn; n++) {
      const lineView = this.lineViews[n];
      // If overlap between position range and line
      if (to >= offset && from < offset + lineView.getSize()) {
        // Get line view position boxes
        const lineViewPositionBox = lineView.mapModelPositionRangeToViewPositionBox(
          Math.max(0, from - offset),
          Math.min(lineView.getSize(), to - offset),
        );
        // Map line view position box to document view position box
        viewPositionBoxes.push({
          x1: lineViewPositionBox.x1,
          y1: cumulatedHeight,
          x2: lineViewPositionBox.x2,
          y2: cumulatedHeight + lineViewPositionBox.height,
        });
      }
      offset += lineView.getSize();
      cumulatedHeight += lineView.getHeight();
    }
    return viewPositionBoxes;
  }

  /**
   * Maps a view position to model position.
   * @param x - X-coordinate of the view position.
   * @param y - Y-coordinate of the view position.
   */
  mapViewPositionToModelPosition(x: number, y: number): number {
    // Iterate through lines until the line that contains the view position
    // is found
    let offset = 0;
    let cumulatedHeight = 0;
    for (let n = 0, nn = this.lineViews.length; n < nn; n++) {
      const lineView = this.lineViews[n];
      // If posterior of line is past Y-coordinate
      if (cumulatedHeight + lineView.getHeight() >= y) {
        // Get model position in line
        const lineModelPosition = lineView.mapViewPositionToModelPosition(x);
        // Map line model position to page model position
        return offset + lineModelPosition;
      }
      offset += lineView.getSize();
      cumulatedHeight += lineView.getHeight();
    }
    return offset - 1;
  }

  /**
   * Resolves a flat model position to a view-aware position
   * object.
   * @param position - Flat model position to resolve.
   */
  resolveModelPosition(position: number): PageViewAwarePosition {
    // Iterate through lines until the line that contains the view position
    // is found
    let offset = 0;
    for (let n = 0, nn = this.lineViews.length; n < nn; n++) {
      const lineView = this.lineViews[n];
      // If posterior of line is past position
      if (offset + lineView.getSize() >= position) {
        // Resolve model position in line
        const lineViewAwarePosition = lineView.resolveModelPosition(position - offset);
        // Map line view aware position to page view aware position
        return {
          ...lineViewAwarePosition,
          pageView: this,
          pageViewPosition: position,
        };
      }
      offset += lineView.getSize();
    }
    throw new Error(`Cannot resolve page model position ${position}.`);
  }
}
