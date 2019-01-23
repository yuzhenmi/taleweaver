import BoxView from './BoxView';
import { TextAtom } from '../element/TextElement';
import measureText from './helpers/measureText';

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
    return measureText(textAtom.getText(), {
      fontFamily: 'sans-serif',
      fontSize: 16,
      fontWeight: 400,
      lineHeight: 18,
      letterSpacing: 0,
    }).width;
  }

  getHeight(): number {
    const textAtom = <TextAtom> this.getAtom();
    return measureText(textAtom.getText(), {
      fontFamily: 'sans-serif',
      fontSize: 16,
      fontWeight: 400,
      lineHeight: 18,
      letterSpacing: 0,
    }).height;
  }
}
