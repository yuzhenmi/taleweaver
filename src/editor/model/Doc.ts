import Block from './block/Block';

/**
 * Models a document. This is the root of the
 * element tree.
 */
export default class Doc {
  /** Child elements. */
  protected children: Block[];

  /**
   * Creates a new document element instance.
   */
  constructor() {
    this.children = [];
  }

  /**
   * Appends a child element.
   * @param child - Child element to append.
   */
  appendChild(child: Block) {
    this.children.push(child);
  }

  /**
   * Removes a child element;
   * @param child - Child element to remove.
   */
  removeChild(child: Block) {
    const index = this.children.indexOf(child);
    if (index < 0) {
      return;
    }
    this.children.splice(index, 1);
  }

  /**
   * Gets all child elements.
   */
  getChildren(): Block[] {
    return this.children;
  }

  /**
   * Gets the size of the document.
   */
  getSize(): number {
    let size = 0;
    this.children.forEach(child => {
      size += child.getSize();
    });
    return size;
  }
}
