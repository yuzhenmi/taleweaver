import Block from '../block/Block';

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

  /**
   * Creates a new word instance.
   * @param block - Block this word belongs to.
   */
  constructor(block: Block) {
    this.block = block;
  }

  /**
   * Gets the type of word.
   */
  abstract getType(): string;

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
