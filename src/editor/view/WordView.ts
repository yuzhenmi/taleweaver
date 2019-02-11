import LineView from './LineView';
import Word from '../model/Word';

/**
 * Word view config.
 */
export interface WordViewConfig {
}

export interface WordViewDOMElements {
  domWord: HTMLElement | Text;
  domWordContent: HTMLElement | Text;
}

/**
 * Describes a screen selection within a word view.
 */
export interface WordViewPositionBox {
  x1: number;
  x2: number;
  height: number;
}

export interface WordViewAwarePosition {
  wordView: WordView;
  wordViewPosition: number;
};

/**
 * Abstract class for word views.
 */
export default abstract class WordView {
  /** Config for the word view. */
  protected config: WordViewConfig;
  /** Word model. */
  protected word: Word;
  /** Parent line view. */
  protected lineView?: LineView;
  /** Rendered DOM element. */
  protected domElement?: HTMLElement | Text;

  /**
   * Creates a new work view instance.
   * @param config - Config for the word view.
   */
  constructor(word: Word, config: WordViewConfig) {
    this.word = word;
    this.config = config;
  }

  /**
   * Gets the size of the word in the document.
   */
  getSize(): number {
    return this.word.getSize();
  }

  /**
   * Sets the parent line view.
   * @param lineView - Parent line view.
   */
  setLineView(lineView: LineView) {
    this.lineView = lineView;
  }

  /**
   * Gets the parent line view.
   */
  getLineView(): LineView {
    return this.lineView!;
  }

  /**
   * Gets the previous word view in the parent line view.
   */
  getPreviousWordView(): WordView | null {
    const wordViews = this.lineView!.getWordViews();
    const index = wordViews.indexOf(this);

    // Short circuit if word view is not found in the parent
    // line view
    if (index < 0) {
      return null;
    }

    // If this is the first word of the line, try to move
    // to last word of previous line
    if (index === 0) {
      const previousLineView = this.lineView!.getPreviousLineView();
      if (!previousLineView) {
        return null;
      }
      const previousLineWordViews = previousLineView.getWordViews();
      return previousLineWordViews[previousLineWordViews.length - 1];
    }
    return wordViews[index - 1];
  }

  /**
   * Gets the next word view in the parent line view.
   */
  getNextWordView(): WordView | null {
    const wordViews = this.lineView!.getWordViews();
    const index = wordViews.indexOf(this);

    // Short circuit if word view is not found in the parent
    // line view
    if (index < 0) {
      return null;
    }

    // If this is the last word of the line, try to move
    // to first word of next line
    if (index === wordViews.length - 1) {
      const nextLineView = this.lineView!.getNextLineView();
      if (!nextLineView) {
        return null;
      }
      const nextLineWordViews = nextLineView.getWordViews();
      return nextLineWordViews[0];
    }
    return wordViews[index + 1];
  }

  /**
   * Mounts the view to DOM.
   */
  abstract mount(): void;

  /**
   * Gets DOM elements mounted by the view.
   */
  abstract getDOM(): WordViewDOMElements;

  /**
   * Gets the width of the word view.
   */
  abstract getWidth(): number;

  /**
   * Gets the height of the word view.
   */
  abstract getHeight(): number;

  /**
   * Maps a model position range to view position boxes.
   * @param from - Left-bound of the model position range.
   * @param to - Right-bound of the model position range.
   */
  abstract mapModelPositionRangeToViewPositionBox(from: number, to: number): WordViewPositionBox;

  /**
   * Maps a view position to model position.
   * @param x - X-coordinate of the view position.
   */
  abstract mapViewPositionToModelPosition(x: number): number;

  /**
   * Resolves a flat model position to a view-aware position
   * object.
   * @param position - Flat model position to resolve.
   */
  resolveModelPosition(position: number): WordViewAwarePosition {
    return {
      wordView: this,
      wordViewPosition: position,
    };
  }
}
