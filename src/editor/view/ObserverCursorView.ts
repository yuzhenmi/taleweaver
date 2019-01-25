import Cursor from '../cursor/Cursor';
import DocumentView from './DocumentView';

export default class ObserverCursorView {
  private observerCursor?: Cursor;
  private documentView?: DocumentView;

  setObserverCursor(observerCursor: Cursor) {
    this.observerCursor = observerCursor;
  }

  setDocumentView(documentView: DocumentView) {
    this.documentView = documentView;
  }

  addToDOM() {
  }

  getObserverCursor(): Cursor {
    return this.observerCursor!;
  }

  getDocumentView(): DocumentView {
    return this.documentView!;
  }
}
