import InlineElement from '../InlineElement';
import Atom from '../Atom';

const BREAKABLE_CHARS = [
  ' ',
  '\t',
  '-',
];

export class TextAtom extends Atom {
  getType(): string {
    return 'Text';
  }
}

export default class TextElement extends InlineElement {
  getType(): string {
    return 'Text';
  }

  getSize(): number {
    return this.text!.length;
  }

  getAtoms(): TextAtom[] {
    const atoms: TextAtom[] = [];
    const text = this.getText();
    let startIndex = 0;
    let n = 0;
    for (let nn = text.length; n < nn; n++) {
      const char = text[n];
      if (BREAKABLE_CHARS.indexOf(char) >= 0) {
        const atom = new TextAtom();
        atom.setText(text.substring(startIndex, n + 1));
        atoms.push(atom);
        startIndex = n + 1;
      }
    }
    if (startIndex !== n) {
      const atom = new TextAtom();
      atom.setText(text.substring(startIndex, n + 1));
      atoms.push(atom);
    }
    return atoms;
  }
}
