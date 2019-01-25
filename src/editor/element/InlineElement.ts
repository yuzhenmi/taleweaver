import BlockElement from './BlockElement';

export abstract class Atom {
  protected inlineElement?: InlineElement;

  abstract getType(): string;

  setInlineElement(inlineElement: InlineElement) {
    this.inlineElement = inlineElement;
  }

  getInlineElement(): InlineElement {
    return this.inlineElement!;
  }

  abstract getSize(): number;
}

export abstract class TextAtom extends Atom {
  abstract getText(): string;
}

export abstract class ObjectAtom extends Atom {
  abstract getWidth(): number;
  abstract getHeight(): number;

  getSize(): number {
    return 1;
  }
}

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
  abstract getAtoms(): Atom[];
}
