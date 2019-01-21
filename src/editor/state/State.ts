import DocumentElement from '../element/DocumentElement';
import Cursor from '../cursor/Cursor';

export default class State {
  private documentElement?: DocumentElement;
  private editorCursors: Cursor[];
  private observerCursors: Cursor[];

  constructor() {
    this.editorCursors = [];
    this.observerCursors = [];
  }

  setDocumentElement(documentElement: DocumentElement) {
    this.documentElement = documentElement;
    documentElement.setState(this);
  }

  appendEditorCursor(cursor: Cursor) {
    this.editorCursors.push(cursor);
  }

  appendObserverCursor(cursor: Cursor) {
    this.observerCursors.push(cursor);
  }

  removeEditorCursor(cursor: Cursor) {
    const index = this.editorCursors.indexOf(cursor);
    if (index < 0) {
      return;
    }
    this.editorCursors.splice(index, 1);
  }

  removeObserverCursor(cursor: Cursor) {
    const index = this.observerCursors.indexOf(cursor);
    if (index < 0) {
      return;
    }
    this.observerCursors.splice(index, 1);
  }

  getDocumentElement(): DocumentElement {
    return this.documentElement!;
  }

  getEditorCursors(): Cursor[] {
    return this.editorCursors;
  }

  getObserverCursors(): Cursor[] {
    return this.observerCursors;
  }
}
