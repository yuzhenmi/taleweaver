import Doc from '../Doc';
import Word from '../word/Word';

/**
 * Models a block element in a document.
 * A block element should be the child of a
 * document element and may contain inline
 * elements as children.
 */
export default abstract class Block {
  /** Parent element. */
  protected parent?: Doc;
  /** Child elements. */
  protected children: Word[];

  /** Creates a new block element instance. */
  constructor() {
    this.children = [];
  }

  /**
   * Gets the type of block element.
   */
  abstract getType(): string;

  /**
   * Sets the parent element.
   * @param parent - Parent element to set.
   */
  setParent(parent: Doc) {
    this.parent = parent;
  }

  /**
   * Gets a parent element.
   */
  getParent(): Doc {
    return this.parent!;
  }

  /**
   * Appends a child element.
   * @param child - Child element to append.
   */
  appendChild(child: Word) {
    this.children.push(child);
  }

  /**
   * Removes a child element.
   * @param child - Child element to remove.
   */
  removeChild(child: Word) {
    const index = this.children.indexOf(child);
    if (index < 0) {
      return;
    }
    this.children.splice(index, 1);
  }

  /**
   * Gets all child elements.
   */
  getChildren(): Word[] {
    return this.children;
  }

  /**
   * Gets the size of the block element.
   */
  getSize(): number {
    let size = 0;
    this.children.forEach(child => {
      size += child.getSize();
    });
    return size;
  }
}
