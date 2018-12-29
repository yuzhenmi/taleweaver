import InlineElement from './InlineElement';
import BlockElement from './BlockElement';

export default class Text implements InlineElement {
  private parent: BlockElement;
  private content: string;

  constructor(parent: BlockElement, content: string) {
    this.parent = parent;
    this.content = content;
  }

  getParent(): BlockElement {
    return this.parent;
  }

  getContent(): string {
    return this.content;
  }
}
