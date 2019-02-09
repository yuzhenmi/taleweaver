import PageView from './PageView';
import WordView from './WordView';

/**
 * Config for a line view.
 */
type LineViewConfig = {
  width: number;
}

/**
 * Describes a screen selection within a line view.
 */
export type LineViewScreenSelection = {
  x1: number;
  x2: number;
  height: number;
}

/**
 * Abstract class for line views.
 */
export default abstract class LineView {
  /** Config for the line view. */
  protected config: LineViewConfig;
  /** Parent page view. */
  protected pageView?: PageView;
  /** Child word views. */
  protected wordViews: WordView[];
  /** Rendered DOM element. */
  protected domElement?: HTMLElement;

  /**
   * Creates a new line view instance.
   * @param config - Config for the line view.
   */
  constructor(config: LineViewConfig) {
    this.config = config;
    this.wordViews = [];
  }

  /**
   * Gets the config.
   */
  getConfig(): LineViewConfig {
    return this.config;
  }

  /**
   * Sets the parent page view.
   * @param pageView - Parent page view.
   */
  setPageView(pageView: PageView) {
    this.pageView = pageView;
  }

  /**
   * Gets the parent page view.
   */
  getPageView(): PageView {
    return this.pageView!;
  }

  /**
   * Appends a child word view.
   * @param wordView - Child word view to append.
   */
  appendWordView(wordView: WordView) {
    this.wordViews.push(wordView);
  }

  /**
   * Removes a child word view.
   * @param wordView - Child word view to remove.
   */
  removeWordView(wordView: WordView) {
    const index = this.wordViews.indexOf(wordView);
    if (index < 0) {
      return;
    }
    this.wordViews.splice(index, 1);
  }

  /**
   * Gets the child word views.
   */
  getWordViews(): WordView[] {
    return this.wordViews;
  }

  /**
   * Gets the size of the line in the document.
   */
  getSize(): number {
    let size = 0;
    this.wordViews!.forEach(wordView => size += wordView.getSize());
    return size;
  }

  /**
   * Binds to the DOM by creating the DOM element
   * and inserting it to the DOM document.
   */
  abstract bindToDOM(): void;

  /**
   * Gets the DOM element.
   */
  getDOMElement(): HTMLElement {
    return this.domElement!;
  }

  /**
   * Gets the screen height of the line view.
   */
  getHeight(): number {
    return Math.max(...this.wordViews.map(wordView => wordView.getHeight()));
  }

  /**
   * Gets the screen selection by document position range.
   * @param from - From document position.
   * @param to - To document position.
   */
  getScreenSelection(from: number, to: number): LineViewScreenSelection {
    if (from < 0 || from > this.getSize()) {
      throw new Error(`Line position out of bound: ${from}.`);
    }
    if (to < 0 || to > this.getSize()) {
      throw new Error(`Line position out of bound: ${to}.`);
    }
    if (from > to) {
      throw new Error('Line from position cannot be greater than to position.');
    }
    let cumulatedSize = 0;
    let cumulatedWidth = 0;
    let x1: number | null = null;
    let x2: number | null = null;
    for (let n = 0, nn = this.wordViews.length; n < nn; n++) {
      const wordView = this.wordViews[n];
      const wordSize = wordView.getSize();
      if (x1 === null && cumulatedSize + wordSize >= from) {
        const wordFrom = from - cumulatedSize;
        const wordTo = Math.min(to - cumulatedSize, wordSize);
        x1 = cumulatedWidth + wordView.getScreenSelection(wordFrom, wordTo).x1;
      }
      if (x1 !== null && cumulatedSize + wordSize >= to) {
        const wordFrom = Math.max(from - cumulatedSize, 0);
        const wordTo = to - cumulatedSize;
        x2 = cumulatedWidth + wordView.getScreenSelection(wordFrom, wordTo).x2;
      }
      if (x1 !== null && x2 !== null) {
        return {
          x1,
          x2,
          height: this.getHeight(),
        };
      }
      cumulatedSize += wordSize;
      cumulatedWidth += wordView.getWidth();
    }
    throw new Error(`Line screen position cannot be determined for range from ${from} to ${to}.`);
  }

  /**
   * Gets the relative document position by screen x coordinate.
   * @param screenX - Screen x coordinate.
   */
  getDocumentPosition(screenX: number): number {
    let currentWidth = 0;
    let currentPosition = 0;
    for (let n = 0, nn = this.wordViews.length; n < nn; n++) {
      const wordView = this.wordViews[n];
      const wordViewWidth = wordView.getWidth();
      if (currentWidth + wordViewWidth >= screenX) {
        return currentPosition + wordView.getDocumentPosition(screenX - currentWidth);
      }
      currentWidth += wordViewWidth;
      currentPosition += wordView.getSize();
    }
    return currentPosition - 1;
  }

  /**
   * Gets the previous line view in the parent page view.
   */
  getPreviousLineView(): LineView | null {
    const lineViews = this.pageView!.getLineViews();
    const index = lineViews.indexOf(this);

    // Short circuit if line view is not found in the parent
    // page view
    if (index < 0) {
      return null;
    }

    // If this is the first line of the page, try to move
    // to last line of previous page
    if (index === 0) {
      const previousPageView = this.pageView!.getPreviousPageView();
      if (!previousPageView) {
        return null;
      }
      const previousPageLineViews = previousPageView.getLineViews();
      return previousPageLineViews[previousPageLineViews.length - 1];
    }
    return lineViews[index - 1];
  }

  /**
   * Gets the next line view in the parent page view.
   */
  getNextLineView(): LineView | null {
    const lineViews = this.pageView!.getLineViews();
    const index = lineViews.indexOf(this);

    // Short circuit if line view is not found in the parent
    // page view
    if (index < 0) {
      return null;
    }

    // If this is the last line of the page, try to move
    // to first line of next page
    if (index === lineViews.length - 1) {
      const nextPageView = this.pageView!.getNextPageView();
      if (!nextPageView) {
        return null;
      }
      const nextPageLineViews = nextPageView.getLineViews();
      return nextPageLineViews[0];
    }
    return lineViews[index + 1];
  }
}
