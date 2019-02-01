import DocumentElement from '../element/DocumentElement';
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
   * Dispatches an event to the event handlers.
   * @param event - Event to dispatch.
   */
  dispatchEvent(event: Event) {
    const cursorTransformer = this.taleWeaver.getRegistry().getCursorTransformer();
    const documentTransformer = this.taleWeaver.getRegistry().getDocumentTransformer();
    const eventHandlers = this.taleWeaver.getRegistry().getEventHandlers();
    eventHandlers.forEach(eventHandler => {
      const {
        cursorTransformations,
        documentTransformations,
      } = eventHandler.handle(event, this);
      if (this.editorCursor) {
        const editorCursor = this.editorCursor;
        cursorTransformations.forEach(transformation => {
          cursorTransformer.apply(editorCursor, transformation);
        });
      }
      if (this.documentElement) {
        const documentElement = this.documentElement;
        documentTransformations.forEach(transformation => {
          documentTransformer.apply(documentElement, transformation);
        });
      }
    });
  }

  /**
   * Applies a transformation on the editor cursor.
   * @param transformation - Transformation to apply.
   */
  transformEditorCursor(transformation: CursorTransformation) {
    if (!this.editorCursor) {
      throw new Error('No editor cursor available to apply transformation.');
    }
    const transformer = this.taleWeaver.getRegistry().getCursorTransformer();
    transformer.apply(this.editorCursor, transformation);
  }

  /**
   * Applies a transformation on an observer cursor.
   * @param cursorID - ID of the observer cursor to transform.
   * @param transformation - Transformation to apply.
   */
  transformObserverCursor(cursorID: string, transformation: CursorTransformation) {
    const cursor = this.observerCursors.find(c => c.getID() === cursorID);
    if (!cursor) {
      throw new Error(`No observer cursor with ID ${cursorID}.`);
    }
    const transformer = this.taleWeaver.getRegistry().getCursorTransformer();
    transformer.apply(cursor, transformation);
  }
}
