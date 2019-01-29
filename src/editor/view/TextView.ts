import BoxView, { BoxViewScreenPosition } from './BoxView';
import { TextAtom } from '../element/inline/TextElement';
import measureText from './helpers/measureText';

const placeholderTextStyle = {
  fontFamily: 'Arial',
  fontSize: 18,
  fontWeight: 400,
  lineHeight: 36,
  letterSpacing: 0,
};

export default class TextView extends BoxView {
  addToDOM() {
    if (this.domElement) {
      return;
    }
    const parentDOMElement = this.getLineView().getDOMElement();
    const textAtom = <TextAtom> this.getAtom();
    this.domElement = document.createTextNode(textAtom.getText());
    parentDOMElement.appendChild(this.domElement);
  }

  getWidth(): number {
    const textAtom = <TextAtom> this.getAtom();
    return measureText(textAtom.getText(), placeholderTextStyle).width;
  }

  getHeight(): number {
    const textAtom = <TextAtom> this.getAtom();
    return measureText(textAtom.getText(), placeholderTextStyle).height;
  }

  getScreenPosition(from: number, to: number): BoxViewScreenPosition {
    const textAtom = <TextAtom> this.getAtom();
    const text = textAtom.getText();
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
    const textAtom = <TextAtom> this.getAtom();
    const text = textAtom.getText();
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
