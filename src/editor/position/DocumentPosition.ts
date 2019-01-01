import Document from '../element/Document';

export default class DocumentPosition {
  private document: Document;
  private position: number;

  constructor(document: Document, position: number) {
    this.document = document;
    this.position = position;
  }

  getDocument(): Document {
    return this.document;
  }

  getPosition(): number {
    return this.position;
  }
}
