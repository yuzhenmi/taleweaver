import BlockElement from './BlockElement';

export default abstract class InlineElement {
  protected parent?: BlockElement;

  abstract getType(): string;

  setParent(parent: BlockElement) {
    this.parent = parent;
  }

  getParent(): BlockElement {
    return this.parent!;
  }

  abstract getSize(): number;
}
