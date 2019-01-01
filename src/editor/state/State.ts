import Document from '../element/Document';
import Cursor from '../cursor/Cursor';

export default class State {
  private document: Document;
  private editingCursors: Cursor[];
  private observingCursors: Cursor[];

  constructor(document: Document, editingCursors: Cursor[] = [], observingCursors: Cursor[] = []) {
    this.document = document;
    this.editingCursors = editingCursors;
    this.observingCursors = observingCursors;
  }

  getDocument(): Document {
    return this.document;
  }

  getEditingCursors(): Cursor[] {
    return this.editingCursors;
  }

  getObservingCursors(): Cursor[] {
    return this.observingCursors;
  }
}
