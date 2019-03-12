import Config from '../Config';
import DocLayout from '../layout/DocLayout';
import PageLayout from '../layout/PageLayout';
import BlockBox from '../layout/BlockBox';
import DocView from './DocView';
import PageView from './PageView';
import BlockView from './BlockView';

export default class ViewAdapter {
  protected config: Config;
  protected docLayout: DocLayout;
  protected docView: DocView;

  constructor(config: Config, docLayout: DocLayout) {
    this.config = config;
    this.docLayout = docLayout;
    this.docView = new DocView();
  }

  mount(domWrapper: HTMLElement) {
    let offset = 0;
    this.docLayout.getChildren().forEach(child => {
      this.docView.insertChild(this.buildPageView(child), offset)
      offset += 1;
    });
    domWrapper.appendChild(this.docView.getDOMContainer());
  }

  private buildPageView(pageLayout: PageLayout): PageView {
    const view = new PageView();
    let offset = 0;
    pageLayout.getChildren().forEach(child => {
      view.insertChild(this.buildBlockView(child), offset);
      offset += 1;
    });
    return view;
  }

  private buildBlockView(blockBox: BlockBox): BlockView {
    const BlockViewClass = this.config.getViewClass(blockBox.getType());
    const view = new BlockViewClass();
    if (!(view instanceof BlockView)) {
      throw new Error(`Error building block view, view built from box of type ${blockBox.getType()} is not block view.`);
    }
    let offset = 0;
    blockBox.getChildren().forEach(child => {
      view.insertChild(this.buildBlockView(child), offset);
      offset += 1;
    });
    return view;
  }
}
