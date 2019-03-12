import EventObserver from './EventObserver';
import Event, { KeyPressEvent } from './Event';
import {
  moveBackward,
  moveForward,
  moveBackwardByWord,
  moveForwardByWord,
  moveToLineStart,
  moveToLineEnd,
  moveToDocumentStart,
  moveToDocumentEnd,
  moveHeadBackward,
  moveHeadForward,
  moveHeadBackwardByWord,
  moveHeadForwardByWord,
  moveHeadToLineStart,
  moveHeadToLineEnd,
  moveHeadToDocumentStart,
  moveHeadToDocumentEnd,
  moveToPreviousLine,
  moveToNextLine,
  moveHeadToPreviousLine,
  moveHeadToNextLine,
} from '../cursor/commands';

export default class EditorCursorEventObserver extends EventObserver {
  onEvent(event: Event) {
    if (event instanceof KeyPressEvent) {
      const keyPressEvent = <KeyPressEvent> event;
      if (keyPressEvent.key === 'ArrowLeft') {
        if (keyPressEvent.shift) {
          if (keyPressEvent.alt) {
            this.dispatchCursorCommand(moveHeadBackwardByWord());
          } else if (keyPressEvent.meta) {
            this.dispatchCursorCommand(moveHeadToLineStart());
          } else {
            this.dispatchCursorCommand(moveHeadBackward());
          }
        } else {
          if (keyPressEvent.alt) {
            this.dispatchCursorCommand(moveBackwardByWord());
          } else if (keyPressEvent.meta) {
            this.dispatchCursorCommand(moveToLineStart());
          } else {
            this.dispatchCursorCommand(moveBackward());
          }
        }
      } else if (keyPressEvent.key === 'ArrowRight') {
        if (keyPressEvent.shift) {
          if (keyPressEvent.alt) {
            this.dispatchCursorCommand(moveHeadForwardByWord());
          } else if (keyPressEvent.meta) {
            this.dispatchCursorCommand(moveHeadToLineEnd());
          } else {
            this.dispatchCursorCommand(moveHeadForward());
          }
        } else {
          if (keyPressEvent.alt) {
            this.dispatchCursorCommand(moveForwardByWord());
          } else if (keyPressEvent.meta) {
            this.dispatchCursorCommand(moveToLineEnd());
          } else {
            this.dispatchCursorCommand(moveForward());
          }
        }
      } else if (keyPressEvent.key === 'ArrowUp') {
        if (keyPressEvent.shift) {
          if (keyPressEvent.alt) {
            this.dispatchCursorCommand(moveHeadToLineStart());
          } else if (keyPressEvent.meta) {
            this.dispatchCursorCommand(moveHeadToDocumentStart());
          } else {
            this.dispatchCursorCommand(moveHeadToPreviousLine());
          }
        } else {
          if (keyPressEvent.alt) {
            this.dispatchCursorCommand(moveToLineStart());
          } else if (keyPressEvent.meta) {
            this.dispatchCursorCommand(moveToDocumentStart());
          } else {
            this.dispatchCursorCommand(moveToPreviousLine());
          }
        }
      } else if (keyPressEvent.key === 'ArrowDown') {
        if (keyPressEvent.shift) {
          if (keyPressEvent.alt) {
            this.dispatchCursorCommand(moveHeadToLineEnd());
          } else if (keyPressEvent.meta) {
            this.dispatchCursorCommand(moveHeadToDocumentEnd());
          } else {
            this.dispatchCursorCommand(moveHeadToNextLine())
          }
        } else {
          if (keyPressEvent.alt) {
            this.dispatchCursorCommand(moveToLineEnd());
          } else if (keyPressEvent.meta) {
            this.dispatchCursorCommand(moveToDocumentEnd());
          } else {
            this.dispatchCursorCommand(moveToNextLine())
          }
        }
      }
    }
  }
}
