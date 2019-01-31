import DocumentElement from './DocumentElement';
import InlineElement from './InlineElement';

/**
 * Models a block element in a document.
 * A block element should be the child of a
 * document element and may contain inline
 * elements as children.
 */
export default abstract class BlockElement {
  /** Parent element. */
  protected parent?: DocumentElement;
  /** Child elements. */
  protected children: InlineElement[];

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
  setParent(parent: DocumentElement) {
    this.parent = parent;
  }

  /**
   * Gets a parent element.
   */
  getParent(): DocumentElement {
    return this.parent!;
  }

  /**
   * Appends a child element.
   * @param child - Child element to append.
   */
  appendChild(child: InlineElement) {
    this.children.push(child);
  }

  /**
   * Removes a child element.
   * @param child - Child element to remove.
   */
  removeChild(child: InlineElement) {
    const index = this.children.indexOf(child);
    if (index < 0) {
      return;
    }
    this.children.splice(index, 1);
  }

  /**
   * Gets all child elements.
   */
  getChildren(): InlineElement[] {
    return this.children;
  }

  /**
   * Gets a child element at a certain position in the block element.
   * @param position - Position in the block element.
   */
  getChildAt(position: number): InlineElement | null {
    let cumulatedSize = 0;
    for (let n = 0, nn = this.children.length; n < nn; n++) {
      cumulatedSize += this.children[n].getSize();
      if (cumulatedSize > position) {
        return this.children[n];
      }
    }
    return null;
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
