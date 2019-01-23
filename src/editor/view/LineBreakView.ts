import BoxView from './BoxView';

export default class LineBreakView extends BoxView {
  addToDOM() {
    if (this.domElement) {
      return;
    }
    const parentDOMElement = this.getLineView().getDOMElement();
    this.domElement = document.createTextNode('');
    parentDOMElement.appendChild(this.domElement);
  }

  getWidth(): number {
    return 0;
  }

  getHeight(): number {
    return 0;
  }
}
