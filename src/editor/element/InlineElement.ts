import BlockElement from './BlockElement';

export default abstract class InlineElement {
  protected parent?: BlockElement;
  protected text: string;

  abstract getType(): string;

  constructor() {
    this.text = '';
  }

  setParent(parent: BlockElement) {
    this.parent = parent;
  }

  setText(text: string) {
    this.text = text;
  }

  getParent(): BlockElement {
    return this.parent!;
  }

  getText(): string {
    return this.text!;
  }

  abstract getSize(): number;
}
