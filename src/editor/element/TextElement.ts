import InlineElement from './InlineElement';

export default class TextElement extends InlineElement {
  private text: string;

  constructor() {
    super();
    this.text = '';
  }

  getType(): string {
    return 'LineBreak';
  }

  getSize(): number {
    return 1;
  }

  setText(text: string) {
    this.text = text;
  }

  getText(): string {
    return this.text;
  }
}
