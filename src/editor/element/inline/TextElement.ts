import InlineElement from '../InlineElement';
import Atom from '../Atom';

/**
 * We can break the inline element at the
 * position after these characters.
 */
const BREAKABLE_CHARS = [
  ' ',
  '\t',
  '-',
];

/**
 * Atom for text elements.
 */
export class TextAtom extends Atom {
  getType(): string {
    return 'Text';
  }
}

/**
 * Text inline element.
 */
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
    let atomFromIndex = 0;
    let textIndex = 0;
    for (let textLength = text.length; textIndex < textLength; textIndex++) {
      const char = text[textIndex];
      if (BREAKABLE_CHARS.indexOf(char) >= 0) {
        const atom = new TextAtom(this);
        atom.setText(text.substring(atomFromIndex, textIndex + 1));
        atoms.push(atom);
        atomFromIndex = textIndex + 1;
      }
    }
    if (atomFromIndex !== textIndex) {
      const atom = new TextAtom(this);
      atom.setText(text.substring(atomFromIndex, textIndex + 1));
      atoms.push(atom);
    }
    return atoms;
  }
}
