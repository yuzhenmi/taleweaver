import BlockElement from './BlockElement';
import InlineElement from './InlineElement';
import Document from './Document';

export default class Paragraph implements BlockElement {
  private parent: Document;
  private children: InlineElement[];

  constructor(parent: Document) {
    this.parent = parent;
    this.children = [];
  }

  getParent(): Document {
    return this.parent;
  }

  appendChild(child: InlineElement) {
    this.children.push(child);
  }

  getChildren(): InlineElement[] {
    return this.children;
  }
}
