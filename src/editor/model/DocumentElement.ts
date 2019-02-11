import BlockElement from './BlockElement';

/**
 * Models a document. This is the root of the
 * element tree.
 */
export default class DocumentElement {
  /** Child elements. */
  protected children: BlockElement[];

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
  appendChild(child: BlockElement) {
    this.children.push(child);
  }

  /**
   * Removes a child element;
   * @param child - Child element to remove.
   */
  removeChild(child: BlockElement) {
    const index = this.children.indexOf(child);
    if (index < 0) {
      return;
    }
    this.children.splice(index, 1);
  }

  /**
   * Gets all child elements.
   */
  getChildren(): BlockElement[] {
    return this.children;
  }

  /**
   * Gets a child element at a certain position in the document.
   * @param position - Position in the document.
   */
  getChildAt(position: number): BlockElement | null {
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
