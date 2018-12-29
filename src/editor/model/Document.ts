import Element from './Element';
import BlockElement from './BlockElement';

export default class Document implements Element {
  private children: BlockElement[];

  constructor() {
    this.children = [];
  }

  getChildren(): BlockElement[] {
    return this.children;
  }

  appendChild(child: BlockElement) {
    this.children.push(child);
  }
}
