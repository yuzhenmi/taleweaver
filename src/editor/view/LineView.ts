import BlockView from './BlockView';
import BoxView from './BoxView';

export default class ParagraphView {
  private blockView?: BlockView;
  private boxViews: BoxView[];
  private domElement?: HTMLElement;

  constructor() {
    this.boxViews = [];
  }

  setBlockView(blockView: BlockView) {
    this.blockView = blockView;
  }

  appendBoxView(boxView: BoxView) {
    this.boxViews.push(boxView);
  }

  removeBoxView(boxView: BoxView) {
    const index = this.boxViews.indexOf(boxView);
    if (index < 0) {
      return;
    }
    this.boxViews.splice(index, 1);
  }

  addToDOM() {
    if (this.domElement) {
      return;
    }
    this.domElement = document.createElement('div');
    this.domElement.className = 'tw--line';
    const parentDOMElement = this.getBlockView().getDOMElement();
    this.boxViews.forEach(boxView => boxView.addToDOM());
    parentDOMElement.appendChild(this.domElement);
  }

  getBlockView(): BlockView {
    return this.blockView!;
  }

  getDOMElement(): HTMLElement {
    return this.domElement!;
  }
}
