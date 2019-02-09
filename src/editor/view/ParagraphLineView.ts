import LineView from './LineView';

export default class ParagraphLineView extends LineView {
  bindToDOM() {
    if (this.domElement) {
      return;
    }
    this.domElement = document.createElement('div');
    this.domElement.className = 'tw--paragraph-line';
    const parentDOMElement = this.getPageView().getContentDOMElement();
    this.wordViews.forEach(wordView => wordView.bindToDOM());
    parentDOMElement.appendChild(this.domElement);
  }
}
