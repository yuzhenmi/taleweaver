import BoxView from './BoxView';
import TextElement from '../element/TextElement';

export default class TextView extends BoxView {
  addToDOM() {
    if (this.domElement) {
      return;
    }
    const parentDOMElement = this.getLineView().getDOMElement();
    const textElement = <TextElement> this.getInlineElement();
    this.domElement = document.createTextNode(textElement.getText());
    parentDOMElement.appendChild(this.domElement);
  }
}
