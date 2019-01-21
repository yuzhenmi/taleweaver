import PageView from './PageView';
import BoxView from './BoxView';

export default abstract class LineView {
  protected pageView?: PageView;
  protected boxViews: BoxView[];
  protected domElement?: HTMLElement;

  constructor() {
    this.boxViews = [];
  }

  setPageView(pageView: PageView) {
    this.pageView = pageView;
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

  abstract addToDOM(): void;

  getPageView(): PageView {
    return this.pageView!;
  }

  getDOMElement(): HTMLElement {
    return this.domElement!;
  }
}
