import EventObserver from '../event/EventObserver';
import Event, { KeyPressEvent } from '../event/Event';
import {
  moveBackwardByChar,
  moveForwardByChar,
  moveBackwardByWord,
  moveForwardByWord,
  moveBackwardByLine,
  moveForwardByLine,
  moveToDocumentStart,
  moveToDocumentEnd,
  moveHeadBackwardByChar,
  moveHeadForwardByChar,
  moveHeadBackwardByWord,
  moveHeadForwardByWord,
  moveHeadBackwardByLine,
  moveHeadForwardByLine,
  moveHeadToDocumentStart,
  moveHeadToDocumentEnd,
} from '../command/cursor';

export default class EditorCursorEventObserver extends EventObserver {
  onEvent(event: Event) {
    if (event instanceof KeyPressEvent) {
      const keyPressEvent = <KeyPressEvent> event;
      if (keyPressEvent.key === 'ArrowLeft') {
        if (keyPressEvent.shift) {
          if (keyPressEvent.alt) {
            this.dispatchCursorCommand(moveHeadBackwardByWord());
          } else if (keyPressEvent.meta) {
            this.dispatchCursorCommand(moveHeadBackwardByLine());
          } else {
            this.dispatchCursorCommand(moveHeadBackwardByChar());
          }
        } else {
          if (keyPressEvent.alt) {
            this.dispatchCursorCommand(moveBackwardByWord());
          } else if (keyPressEvent.meta) {
            this.dispatchCursorCommand(moveBackwardByLine());
          } else {
            this.dispatchCursorCommand(moveBackwardByChar());
          }
        }
      } else if (keyPressEvent.key === 'ArrowRight') {
        if (keyPressEvent.shift) {
          if (keyPressEvent.alt) {
            this.dispatchCursorCommand(moveHeadForwardByWord());
          } else if (keyPressEvent.meta) {
            this.dispatchCursorCommand(moveHeadForwardByLine());
          } else {
            this.dispatchCursorCommand(moveHeadForwardByChar());
          }
        } else {
          if (keyPressEvent.alt) {
            this.dispatchCursorCommand(moveForwardByWord());
          } else if (keyPressEvent.meta) {
            this.dispatchCursorCommand(moveForwardByLine());
          } else {
            this.dispatchCursorCommand(moveForwardByChar());
          }
        }
      } else if (keyPressEvent.key === 'ArrowUp') {
        if (keyPressEvent.shift) {
          if (keyPressEvent.alt) {
            this.dispatchCursorCommand(moveHeadBackwardByLine());
          } else if (keyPressEvent.meta) {
            this.dispatchCursorCommand(moveHeadToDocumentStart());
          } else {
            // TODO: Move cursor head to previous line but preserve horizontal position
          }
        } else {
          if (keyPressEvent.alt) {
            this.dispatchCursorCommand(moveBackwardByLine());
          } else if (keyPressEvent.meta) {
            this.dispatchCursorCommand(moveToDocumentStart());
          } else {
            // TODO: Move cursor to previous line but preserve horizontal position
          }
        }
      } else if (keyPressEvent.key === 'ArrowDown') {
        if (keyPressEvent.shift) {
          if (keyPressEvent.alt) {
            this.dispatchCursorCommand(moveHeadForwardByLine());
          } else if (keyPressEvent.meta) {
            this.dispatchCursorCommand(moveHeadToDocumentEnd());
          } else {
            // TODO: Move cursor head to next line but preserve horizontal position
          }
        } else {
          if (keyPressEvent.alt) {
            this.dispatchCursorCommand(moveForwardByLine());
          } else if (keyPressEvent.meta) {
            this.dispatchCursorCommand(moveToDocumentEnd());
          } else {
            // TODO: Move cursor to next line but preserve horizontal position
          }
        }
      }
    }
  }
}
