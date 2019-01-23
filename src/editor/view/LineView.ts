import PageView from './PageView';
import BoxView from './BoxView';

type LineViewConfig = {
  width: number;
}

export default abstract class LineView {
  protected config: LineViewConfig;
  protected pageView?: PageView;
  protected boxViews: BoxView[];
  protected domElement?: HTMLElement;

  constructor(config: LineViewConfig) {
    this.config = config;
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

  getConfig(): LineViewConfig {
    return this.config;
  }

  getPageView(): PageView {
    return this.pageView!;
  }

  getDOMElement(): HTMLElement {
    return this.domElement!;
  }

  getHeight(): number {
    return Math.max(...this.boxViews.map(boxView => boxView.getHeight()));
  }
}
