import DocumentPosition from '../DocumentPosition';
import PageLayout from '../../layout/PageLayout';

export default class PageLayoutPosition {
  private documentPosition: DocumentPosition;
  private pageLayout: PageLayout;
  private position: number;

  constructor(documentPosition: DocumentPosition, pageLayout: PageLayout, position: number) {
    this.documentPosition = documentPosition;
    this.pageLayout = pageLayout;
    this.position = position;
  }

  getDocumentPosition(): DocumentPosition {
    return this.documentPosition;
  }

  getPageLayout(): PageLayout {
    return this.pageLayout;
  }

  getPosition(): number {
    return this.position;
  }
}
