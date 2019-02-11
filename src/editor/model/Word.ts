import InlineElement from './InlineElement';

/**
 * Models a segment of the document that
 * cannot be split when rendered. This is
 * the basic building block of a document's
 * layout.
 */
export default abstract class Word {
  /** Inline element this word belongs to. */
  protected inlineElement: InlineElement;
  /** Text content. */
  protected text?: string;

  /**
   * Creates a new word instance.
   * @param inlineElement - Inline element this word belongs to.
   */
  constructor(inlineElement: InlineElement) {
    this.inlineElement = inlineElement;
  }

  /**
   * Gets the type of word.
   */
  abstract getType(): string;

  /**
   * Gets the inline element this word belongs to.
   */
  getInlineElement(): InlineElement {
    return this.inlineElement;
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
