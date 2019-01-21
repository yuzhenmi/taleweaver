import DocumentElement from './DocumentElement';
import InlineElement from './InlineElement';

export default abstract class BlockElement {
  protected parent?: DocumentElement;
  protected children: InlineElement[];

  constructor() {
    this.children = [];
  }

  abstract getType(): string;

  setParent(parent: DocumentElement) {
    this.parent = parent;
  }

  appendChild(child: InlineElement) {
    this.children.push(child);
  }

  removeChild(child: InlineElement) {
    const index = this.children.indexOf(child);
    if (index < 0) {
      return;
    }
    this.children.splice(index, 1);
  }

  getParent(): DocumentElement {
    return this.parent!;
  }

  getChildren(): InlineElement[] {
    return this.children;
  }

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

  getSize(): number {
    let size = 0;
    this.children.forEach(child => {
      size += child.getSize();
    });
    return size;
  }
}
