import PageLayout from './PageLayout';

export default class DocLayout {
  protected pageLayouts: PageLayout[];

  constructor() {
    this.pageLayouts = [];
  }

  insertPageLayout(pageLayout: PageLayout) {
    this.pageLayouts.push(pageLayout);
  }

  getChildren(): PageLayout[] {
    return this.pageLayouts;
  }
}
