import BlockView from './BlockView';

export default class ParagraphView extends BlockView {
  addToDOM() {
    if (this.domElement) {
      return;
    }
    this.domElement = document.createElement('div');
    this.domElement.className = 'tw--paragraph';
    const parentDOMElement = this.getPageView().getDOMElement();
    this.lineViews.forEach(lineView => lineView.addToDOM());
    parentDOMElement.appendChild(this.domElement);
  }
}
