import PageView from './PageView';
import LineView from './LineView';
import BlockElement from '../element/BlockElement';

export default abstract class BlockView {
  protected blockElement?: BlockElement;
  protected pageView?: PageView;
  protected lineViews: LineView[];
  protected domElement?: HTMLElement;

  constructor() {
    this.lineViews = [];
  }

  setBlockElement(blockElement: BlockElement) {
    this.blockElement = blockElement;
  }

  setPageView(pageView: PageView) {
    this.pageView = pageView;
  }

  appendLineView(lineView: LineView) {
    this.lineViews.push(lineView);
  }

  removeLineView(lineView: LineView) {
    const index = this.lineViews.indexOf(lineView);
    if (index < 0) {
      return;
    }
    this.lineViews.splice(index, 1);
  }

  abstract addToDOM(): void;

  getBlockElement(): BlockElement {
    return this.blockElement!;
  }

  getPageView(): PageView {
    return this.pageView!;
  }

  getDOMElement(): HTMLElement {
    return this.domElement!;
  }
}
