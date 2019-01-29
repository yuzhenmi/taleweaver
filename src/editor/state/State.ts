import DocumentElement from '../element/DocumentElement';
import Cursor from '../cursor/Cursor';
import CursorStateTransformation from '../state/CursorStateTransformation';
import CursorStateTransformer from './CursorStateTransformer';

export default class State {
  private documentElement?: DocumentElement;
  private editorCursor: Cursor | null;
  private cursorStateTransformer: CursorStateTransformer | null;
  private observerCursors: Cursor[];

  constructor() {
    this.editorCursor = null;
    this.cursorStateTransformer = null;
    this.observerCursors = [];
  }

  setDocumentElement(documentElement: DocumentElement) {
    this.documentElement = documentElement;
    documentElement.setState(this);
  }

  setEditorCursor(cursor: Cursor) {
    this.editorCursor = cursor;
    this.cursorStateTransformer = new CursorStateTransformer(cursor);
  }

  appendObserverCursor(cursor: Cursor) {
    this.observerCursors.push(cursor);
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

  getEditorCursor(): Cursor | null {
    return this.editorCursor;
  }

  getObserverCursors(): Cursor[] {
    return this.observerCursors;
  }

  transformCursorState(transformation: CursorStateTransformation) {
    // Do not do anything if there is no transformer
    if (!this.cursorStateTransformer) {
      return;
    }

    // Apply transformation
    this.cursorStateTransformer.apply(transformation);
  }
}
