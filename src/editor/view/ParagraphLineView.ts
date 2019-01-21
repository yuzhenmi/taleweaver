import LineView from './LineView';

export default class ParagraphLineView extends LineView {
  addToDOM() {
    if (this.domElement) {
      return;
    }
    this.domElement = document.createElement('div');
    this.domElement.className = 'tw--paragraph-line';
    const parentDOMElement = this.getPageView().getDOMElement();
    this.boxViews.forEach(boxView => boxView.addToDOM());
    parentDOMElement.appendChild(this.domElement);
  }
}
