import PageView from './PageView';
import WordView, { WordViewAwarePosition } from './WordView';

/**
 * Line view configs.
 */
export interface LineViewConfig {
  width: number;
}

export interface LineViewDOMElements {
  domLine: HTMLElement;
  domLineContent: HTMLElement;
}

/**
 * Describes a screen selection within a line view.
 */
export interface LineViewPositionBox {
  x1: number;
  x2: number;
  height: number;
}

export interface LineViewAwarePosition extends WordViewAwarePosition {
  lineView: LineView;
  lineViewPosition: number;
};

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

  /**
   * Creates a new line view instance.
   * @param config - Config for the line view.
   */
  constructor(config: LineViewConfig) {
    this.config = config;
    this.wordViews = [];
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
   * Mounts the view to DOM.
   */
  abstract mount(): void;

  /**
   * Gets DOM elements mounted by the view.
   */
  abstract getDOM(): LineViewDOMElements;

  /**
   * Gets the height of the view.
   */
  getHeight(): number {
    return Math.max(...this.wordViews.map(wordView => wordView.getHeight()));
  }

  /**
   * Maps a model position range to view position boxes.
   * @param from - Left-bound of the model position range.
   * @param to - Right-bound of the model position range.
   */
  mapModelPositionRangeToViewPositionBox(from: number, to: number): LineViewPositionBox {
    // Iterate through words to break up model position range
    const viewPositionBox: LineViewPositionBox = {
      x1: -1,
      x2: -1,
      height: 0,
    };
    let offset = 0;
    let cumulatedWidth = 0;
    for (let n = 0, nn = this.wordViews.length; n < nn; n++) {
      const wordView = this.wordViews[n];
      // If overlap between position range and word
      if (to >= offset && from < offset + wordView.getSize()) {
        const wordViewPositionBox = wordView.mapModelPositionRangeToViewPositionBox(
          Math.max(0, from - offset),
          Math.min(wordView.getSize(), to - offset),
        );
        if (offset <= from && offset + wordView.getSize() > from) {
          viewPositionBox.x1 = cumulatedWidth + wordViewPositionBox.x1;
        }
        if (offset <= to && offset + wordView.getSize() > to) {
          viewPositionBox.x2 = cumulatedWidth + wordViewPositionBox.x2;
        }
        if (viewPositionBox.height < wordViewPositionBox.height) {
          viewPositionBox.height = wordViewPositionBox.height;
        }
      }
      offset += wordView.getSize();
      cumulatedWidth += wordView.getWidth();
    }
    return viewPositionBox;
  }

  /**
   * Maps a view position to model position.
   * @param x - X-coordinate of the view position.
   */
  mapViewPositionToModelPosition(x: number): number {
    // Iterate through words until the word that contains the view position
    // is found
    let offset = 0;
    let cumulatedWidth = 0;
    for (let n = 0, nn = this.wordViews.length; n < nn; n++) {
      const wordView = this.wordViews[n];
      // If posterior of word is past Y-coordinate
      if (cumulatedWidth + wordView.getWidth() >= x) {
        // Get model position in word
        const wordModelPosition = wordView.mapViewPositionToModelPosition(cumulatedWidth + x);
        // Map word model position to line model position
        return offset + wordModelPosition;
      }
      offset += wordView.getSize();
      cumulatedWidth += wordView.getWidth();
    }
    return offset - 1;
  }

  /**
   * Resolves a flat model position to a view-aware position
   * object.
   * @param position - Flat model position to resolve.
   */
  resolveModelPosition(position: number): LineViewAwarePosition {
    // Iterate through words until the word that contains the view position
    // is found
    let offset = 0;
    for (let n = 0, nn = this.wordViews.length; n < nn; n++) {
      const wordView = this.wordViews[n];
      // If posterior of word is past position
      if (offset + wordView.getSize() >= position) {
        // Resolve model position in word
        const wordViewAwarePosition = wordView.resolveModelPosition(position - offset);
        // Map word view aware position to line view aware position
        return {
          ...wordViewAwarePosition,
          lineView: this,
          lineViewPosition: position,
        };
      }
      offset += wordView.getSize();
    }
    throw new Error(`Cannot resolve line model position ${position}.`);
  }
}
