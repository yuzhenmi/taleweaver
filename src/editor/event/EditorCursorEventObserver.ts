import EventObserver from '../event/EventObserver';
import Event, { KeyPressEvent } from '../event/Event';
import TaleWeaver from '../TaleWeaver';
import { translate, translateHead, collapseBackward, collapseForward } from '../state/helpers/editorCursorTransformations';

export default class EditorCursorEventObserver extends EventObserver {
  notify(event: Event, taleWeaver: TaleWeaver) {
    const state = taleWeaver.getState();
    const documentView = taleWeaver.getDocumentView();
    if (!state.getEditorCursor()) {
      return;
    }
    const editorCursor = state.getEditorCursor()!;
    if (event instanceof KeyPressEvent) {
      const keyPressEvent = <KeyPressEvent> event;
      if (keyPressEvent.key === 'ArrowLeft') {
        let translateBy;
        if (keyPressEvent.meta) {
          // Move to beginning of line
          const cursorPosition = editorCursor.getHead();
          const targetPosition = documentView.getLineStartPosition(cursorPosition);
          translateBy = targetPosition - cursorPosition;
        } else if (keyPressEvent.alt) {
          // Move to beginning of word
          // Move to beginning of previous word
          console.log('ALT DOWN');
          translateBy = 0;
        } else {
          if (!keyPressEvent.shift && editorCursor.getAnchor() !== editorCursor.getHead()) {
            // Collapse backward
            this.dispatchEditorCursorTransformation(collapseBackward(taleWeaver));
            translateBy = 0;
          } else {
            // Move to left
            translateBy = -1;
          }
        }
        if (translateBy !== 0) {
          if (keyPressEvent.shift) {
            // Move head
            this.dispatchEditorCursorTransformation(translateHead(translateBy, taleWeaver));
          } else {
            // Move cursor
            this.dispatchEditorCursorTransformation(translate(translateBy, taleWeaver));
          }
        }
      } else if (keyPressEvent.key === 'ArrowRight') {
        let translateBy;
        if (keyPressEvent.meta) {
          // Move to end of line
          const cursorPosition = editorCursor.getHead();
          const targetPosition = documentView.getLineEndPosition(cursorPosition);
          translateBy = targetPosition - cursorPosition;
        } else if (keyPressEvent.alt) {
          // Move to end of word
          // Move to end of previous word
          console.log('ALT DOWN');
          translateBy = 0;
        } else {
          if (!keyPressEvent.shift && editorCursor.getAnchor() !== editorCursor.getHead()) {
            // Collapse forward
            this.dispatchEditorCursorTransformation(collapseForward(taleWeaver));
            translateBy = 0;
          } else {
            // Move to right
            translateBy = 1;
          }
        }
        if (translateBy !== 0) {
          if (keyPressEvent.shift) {
            // Move head
            this.dispatchEditorCursorTransformation(translateHead(translateBy, taleWeaver));
          } else {
            // Move cursor
            this.dispatchEditorCursorTransformation(translate(translateBy, taleWeaver));
          }
        }
      }
    }
  }
}
