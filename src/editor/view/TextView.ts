import BoxView, { BoxViewScreenPosition } from './BoxView';
import TextWord from '../element/word/TextWord';
import measureText from './helpers/measureText';

const placeholderTextStyle = {
  fontFamily: 'Arial',
  fontSize: 18,
  fontWeight: 400,
  lineHeight: 36,
  letterSpacing: 0,
};

export default class TextView extends BoxView {
  private width?: number;
  private height?: number;

  private measure() {
    const textWord = <TextWord> this.getWord();
    const measurement = measureText(textWord.getText(), placeholderTextStyle);
    this.width = measurement.width;
    this.height = measurement.height;
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

  getScreenPosition(from: number, to: number): BoxViewScreenPosition {
    const textWord = <TextWord> this.getWord();
    const text = textWord.getText();
    let left: number;
    if (from === 0) {
      left = 0;
    } else {
      left = measureText(text.substring(0, from), placeholderTextStyle).width;
    }
    let right: number;
    if (to === 0) {
      right = 0;
    } else if (to === from) {
      right = left;
    } else {
      right = measureText(text.substring(0, to), placeholderTextStyle).width;
    }
    return {
      left,
      width: right - left,
      height: this.getHeight(),
    };
  }

  getDocumentPosition(screenPosition: number): number {
    // Step through each character until we reach
    // the screen position
    const textWord = <TextWord> this.getWord();
    const text = textWord.getText();
    let lastWidth = 0;
    for (let n = 1, nn = text.length; n < nn; n++) {
      const width = measureText(text.substring(0, n), placeholderTextStyle).width;
      if (width > screenPosition) {
        if (screenPosition - lastWidth > width - screenPosition) {
          return n;
        }
        return n - 1;
      }
      lastWidth = width;
    }
    return text.length;
  }
}
