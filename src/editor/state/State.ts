import DocumentElement from '../model/DocumentElement';
import Cursor from '../cursor/Cursor';
import CursorTransformation from './CursorTransformation';
import TaleWeaver from '../TaleWeaver';
import Event from '../event/Event';

/**
 * State container for TaleWeaver.
 * Keeps track of the state of the document
 * and its cursors.
 */
export default class State {
  /** TaleWeaver instance. */
  private taleWeaver: TaleWeaver;
  /** Document element. */
  private documentElement?: DocumentElement;
  /** Editor cursor. */
  private editorCursor: Cursor | null;
  /** Observer cursors. */
  private observerCursors: Cursor[];

  /**
   * Creates a new state instance.
   * @param taleWeaver - TaleWeaver instance.
   */
  constructor(taleWeaver: TaleWeaver) {
    this.taleWeaver = taleWeaver;
    this.editorCursor = null;
    this.observerCursors = [];
  }

  /**
   * Sets the document element.
   * @param documentElement - Document element to set.
   */
  setDocumentElement(documentElement: DocumentElement) {
    this.documentElement = documentElement;
  }

  /**
   * Gets the document element.
   */
  getDocumentElement(): DocumentElement {
    return this.documentElement!;
  }

  /**
   * Sets the editor cursor.
   * @param cursor - Editor cursor to set.
   */
  setEditorCursor(cursor: Cursor) {
    this.editorCursor = cursor;
  }

  /**
   * Gets the editor cursor. It's possible to not have an editor cursor.
   */
  getEditorCursor(): Cursor | null {
    return this.editorCursor;
  }

  /**
   * Gets all observer cursors.
   */
  getObserverCursors(): Cursor[] {
    return this.observerCursors;
  }

  /**
   * Appends an observer cursor.
   * @param cursor - Observer cursor to append.
   */
  appendObserverCursor(cursor: Cursor) {
    this.observerCursors.push(cursor);
  }

  /**
   * Removes an observer cursor.
   * @param cursor - Observer cursor to remove.
   */
  removeObserverCursor(cursor: Cursor) {
    const index = this.observerCursors.indexOf(cursor);
    if (index < 0) {
      return;
    }
    this.observerCursors.splice(index, 1);
  }

  /**
   * Dispatches an event to the event observers.
   * @param event - Event to dispatch.
   */
  dispatchEvent(event: Event) {
    const eventObservers = this.taleWeaver.getRegistry().getEventObservers();
    eventObservers.forEach(eventObserver => {
      eventObserver.onEvent(event);
    });
  }

  /**
   * Applies a transformation on the editor cursor.
   * @param transformation - Cursor transformation to apply.
   */
  applyEditorCursorTransformation(transformation: CursorTransformation) {
    if (!this.editorCursor) {
      throw new Error('No editor cursor available to apply transformation.');
    }
    const transformer = this.taleWeaver.getRegistry().getCursorTransformer();
    transformer.apply(this.editorCursor, transformation);
  }
}
