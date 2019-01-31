import InlineElement from './InlineElement';

/**
 * Models a segment of the document that
 * cannot be split when rendered. This is
 * the basic building block of a document's
 * layout.
 */
export default abstract class Atom {
  /** Inline element this atom belongs to. */
  protected inlineElement: InlineElement;
  /** Text content. */
  protected text?: string;

  /**
   * Creates a new atom instance.
   * @param inlineElement - Inline element this atom belongs to.
   */
  constructor(inlineElement: InlineElement) {
    this.inlineElement = inlineElement;
  }

  /**
   * Gets the type of atom.
   */
  abstract getType(): string;

  /**
   * Gets the inline element this atom belongs to.
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
   * Gets the size of the atom.
   */
  getSize(): number {
    return this.text!.length;
  }
}
