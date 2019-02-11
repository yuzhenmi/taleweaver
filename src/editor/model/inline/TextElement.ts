import InlineElement from '../InlineElement';
import TextWord from '../word/TextWord';

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
 * Text inline element.
 */
export default class TextElement extends InlineElement {
  getType(): string {
    return 'Text';
  }

  getSize(): number {
    return this.text!.length;
  }

  getWords(): TextWord[] {
    const words: TextWord[] = [];
    const text = this.getText();
    let wordFromIndex = 0;
    let textIndex = 0;
    for (let textLength = text.length; textIndex < textLength; textIndex++) {
      const char = text[textIndex];
      if (BREAKABLE_CHARS.indexOf(char) >= 0) {
        const word = new TextWord(this);
        word.setText(text.substring(wordFromIndex, textIndex + 1));
        words.push(word);
        wordFromIndex = textIndex + 1;
      }
    }
    if (wordFromIndex !== textIndex) {
      const word = new TextWord(this);
      word.setText(text.substring(wordFromIndex, textIndex + 1));
      words.push(word);
    }
    return words;
  }
}
