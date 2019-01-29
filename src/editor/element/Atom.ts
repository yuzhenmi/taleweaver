import InlineElement from './InlineElement';

export default abstract class Atom {
  protected inlineElement?: InlineElement;
  protected text?: string;

  abstract getType(): string;

  setInlineElement(inlineElement: InlineElement) {
    this.inlineElement = inlineElement;
  }

  getInlineElement(): InlineElement {
    return this.inlineElement!;
  }

  setText(text: string) {
    this.text = text;
  }

  getText(): string {
    return this.text!;
  };

  getSize(): number {
    return this.text!.length;
  }
}
