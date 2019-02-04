import WordView, { WordViewScreenSelection } from './WordView';
import TextWord from '../element/word/TextWord';
import measureText from './helpers/measureText';

const placeholderTextStyle = {
  fontFamily: 'Arial',
  fontSize: 18,
  fontWeight: 400,
  lineHeight: 36,
  letterSpacing: 0,
};

/**
 * View for a text word.
 */
export default class TextView extends WordView {
  /** Cached width of the rendered text word */
  private width?: number;
  /** Cached height of the rendered text word */
  private height?: number;

  /**
   * Measures the dimensions of the rendered text word.
   */
  private measure() {
    const textWord = <TextWord> this.getWord();
    const measurement = measureText(textWord.getText(), placeholderTextStyle);
    this.width = measurement.width;
    this.height = measurement.height;
  }

  /**
   * Gets screen x coordinate by document position.
   * @param at - Document position within the text word.
   */
  private getScreenX(at: number): number {
    const textWord = <TextWord> this.getWord();
    const text = textWord.getText();
    if (at === 0) {
      return 0;
    }
    return measureText(text.substring(0, at), placeholderTextStyle).width;
  }

  bindToDOM() {
    if (this.domElement) {
      return;
    }
    const parentDOMElement = this.getLineView().getDOMElement();
    const textWord = <TextWord> this.getWord();
    this.domElement = document.createTextNode(textWord.getText());
    parentDOMElement.appendChild(this.domElement);
  }

  getWidth(): number {
    if (this.width === undefined) {
      this.measure();
    }
    return this.width!;
  }

  getHeight(): number {
    if (this.height === undefined) {
      this.measure();
    }
    return this.height!;
  }

  getScreenSelection(from: number, to: number): WordViewScreenSelection {
    if (from < 0 || from > this.getSize()) {
      throw new Error(`Text word position out of bound: ${from}.`);
    }
    if (to < 0 || to > this.getSize()) {
      throw new Error(`Text word position out of bound: ${to}.`);
    }
    if (from > to) {
      throw new Error('Text word from position cannot be greater than to position.');
    }
    return {
      x1: this.getScreenX(from),
      x2: this.getScreenX(to),
      height: this.getHeight(),
    };
  }

  getDocumentPosition(screenX: number): number {
    const textWord = <TextWord> this.getWord();
    const text = textWord.getText();
    let lastWidth = 0;
    for (let n = 1, nn = text.length; n < nn; n++) {
      const width = measureText(text.substring(0, n), placeholderTextStyle).width;
      if (width > screenX) {
        if (screenX - lastWidth > width - screenX) {
          return n;
        }
        return n - 1;
      }
      lastWidth = width;
    }
    return text.length;
  }
}
