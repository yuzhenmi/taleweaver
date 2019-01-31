import BlockElement from './BlockElement';
import Atom from './Atom';

/**
 * Models an inline element in a document.
 * An inline element should be the child of
 * a block element.
 */
export default abstract class InlineElement {
  /** Parent element. */
  protected parent?: BlockElement;
  /** Text content. */
  protected text?: string;

  /**
   * Gets the type of inline element.
   */
  abstract getType(): string;

  /**
   * Sets the parent element.
   * @param parent - Parent element to set.
   */
  setParent(parent: BlockElement) {
    this.parent = parent;
  }

  /**
   * Gets a parent element.
   */
  getParent(): BlockElement {
    return this.parent!;
  }

  /**
   * Sets the text content.
   * @param text - Text content to set.
   */
  setText(text: string) {
    this.text = text;
  }

  /**
   * Gets the text content.
   */
  getText(): string {
    return this.text!;
  }

  /**
   * Gets the size of the inline element.
   */
  abstract getSize(): number;

  /**
   * Gets atoms by breaking down the inline element.
   */
  abstract getAtoms(): Atom[];
}
