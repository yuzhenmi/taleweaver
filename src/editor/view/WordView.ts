import LineView from './LineView';
import Word from '../element/Word';

/**
 * Config for a word view.
 */
type WordViewConfig = {
}

/**
 * Describes a screen selection within a word view.
 */
export type WordViewScreenSelection = {
  x1: number;
  x2: number;
  height: number;
}

/**
 * Abstract class for word views.
 */
export default abstract class WordView {
  /** Config for the word view. */
  protected config: WordViewConfig;
  /** Word model. */
  protected word?: Word;
  /** Parent line view. */
  protected lineView?: LineView;
  /** Rendered DOM element. */
  protected domElement?: HTMLElement | Text;

  /**
   * Creates a new work view instance.
   * @param config - Config for the word view.
   */
  constructor(config: WordViewConfig) {
    this.config = config;
  }

  /**
   * Gets the config.
   */
  getConfig(): WordViewConfig {
    return this.config;
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
   * Sets the word model.
   * @param word - Word model.
   */
  setWord(word: Word) {
    this.word = word;
  }

  /**
   * Gets the word model.
   */
  getWord(): Word {
    return this.word!;
  }

  /**
   * Gets the size of the word in the document.
   */
  getSize(): number {
    return this.getWord().getSize();
  }

  /**
   * Binds to the DOM by creating the DOM element
   * and inserting it to the DOM document.
   */
  abstract bindToDOM(): void;

  /**
   * Gets the DOM element.
   */
  getDOMElement(): HTMLElement | Text {
    return this.domElement!;
  }

  /**
   * Gets the screen width of the word view.
   */
  abstract getWidth(): number;

  /**
   * Gets the screen height of the word view.
   */
  abstract getHeight(): number;

  /**
   * Gets the screen selection by document position range.
   * @param from - From document position.
   * @param to - To document position.
   */
  abstract getScreenSelection(from: number, to: number): WordViewScreenSelection;

  /**
   * Gets the relative document position by screen x coordinate.
   * @param screenX - Screen x coordinate.
   */
  abstract getDocumentPosition(screenX: number): number;
}
