import InlineElement, { TextAtom as AbstractTextAtom } from './InlineElement';

const BREAKABLE_CHARS = [
  ' ',
  '\t',
  '-',
];

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

  getSize(): number {
    return this.text!.length;
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
    const atoms: TextAtom[] = [];
    const text = this.getText();
    let startIndex = 0;
    for (let n = 0, nn = text.length; n < nn; n++) {
      const char = text[n];
      if (BREAKABLE_CHARS.indexOf(char) >= 0) {
        const atom = new TextAtom();
        atom.setText(text.substring(startIndex, n + 1));
        atoms.push(atom);
        startIndex = n + 1;
      }
    }
    return atoms;
  }
}
