import Document from '../model/Document';
import Cursor from '../cursor/Cursor';

export default class State {
  private document: Document;
  private editingCursors: Cursor[];
  private observingCursors: Cursor[];

  constructor(document: Document, editingCursors?: Cursor[], observingCursors?: Cursor[]) {
    this.document = document;
    if (editingCursors) {
      this.editingCursors = editingCursors;
    } else {
      this.editingCursors = [];
    }
    if (observingCursors) {
      this.observingCursors = observingCursors;
    } else {
      this.observingCursors = [];
    }
  }

  getDocument(): Document {
    return this.document;
  }

  getEditingCursors(): Cursor[] {
    return this.editingCursors;
  }
}
