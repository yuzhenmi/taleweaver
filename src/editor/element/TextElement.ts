import InlineElement, { TextAtom as AbstractTextAtom } from './InlineElement';

export class TextAtom extends AbstractTextAtom {
  private text?: string;

  getType(): string {
    return 'Text';
  }

  setText(text: string) {
    this.text = text;
  }

  getText(): string {
    return this.text!;
  }
}

export default class TextElement extends InlineElement {
  getType(): string {
    return 'Text';
  }

  getSize(): number {
    return 1;
  }

  getAtoms(): TextAtom[] {
    return this.getText().split(/\s/g).map(s => {
      const atom = new TextAtom();
      atom.setText(s);
      return atom;
    });
  }
}
