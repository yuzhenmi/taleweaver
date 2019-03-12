import Config from '../Config';
import DocLayout from '../layout/DocLayout';
import DocView from './DocView';

export default class ViewAdapter {
  protected config: Config;
  protected docLayout: DocLayout;
  protected docView: DocView;
  
  constructor(config: Config, docLayout: DocLayout) {
    this.config = config;
    this.docLayout = docLayout;
    this.docView = new DocView();
    this.sendToView();
  }

  getDocView(): DocView {
    return this.docView;
  }

  protected sendToView() {
    // Iterate through layout tree and create,
    // update and delete corresponding views
  }
}
