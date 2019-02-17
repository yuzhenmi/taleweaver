import Block from '../block/Block';

/** Observer to word state change. */
type WordObserver = (word: Word) => void;

/**
 * Models a segment of the document that
 * cannot be split when rendered. This is
 * the basic building block of a document's
 * layout.
 */
export default abstract class Word {
  /** Block this word belongs to. */
  protected block: Block;
  /** Text content. */
  protected text?: string;
  /** Observers registered with the word. */
  private observers: WordObserver[];

  /**
   * Creates a new word instance.
   * @param block - Block this word belongs to.
   */
  constructor(block: Block) {
    this.block = block;
    this.observers = [];
  }

  /**
   * Gets the type of word.
   */
  abstract getType(): string;

  /**
   * Notifies observers of state change.
   */
  private notifyObservers() {
    this.observers.forEach(observer => {
      observer(this);
    });
  }

  /**
   * Registers an observer.
   * @param observer - Observer to register.
   */
  observe(observer: WordObserver) {
    this.observers.push(observer);
  }

  /**
   * Gets the block this word belongs to.
   */
  getBlock(): Block {
    return this.block;
  }

  /**
   * Sets the text content.
   * @param text - The text content to set.
   */
  setText(text: string) {
    this.text = text;
    this.notifyObservers();
  }

  /**
   * Gets the text content.
   */
  getText(): string {
    return this.text!;
  };

  /**
   * Gets the size of the word.
   */
  getSize(): number {
    return this.text!.length;
  }
}
