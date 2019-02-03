import EventObserver from '../event/EventObserver';
import Event, { KeyPressEvent } from '../event/Event';
import {
  moveLeft,
  moveHeadLeft,
  moveRight,
  moveHeadRight,
  moveLeftByWord,
  moveHeadLeftByWord,
  moveRightByWord,
  moveHeadRightByWord,
  moveLeftByLine,
  moveHeadLeftByLine,
  moveRightByLine,
  moveHeadRightByLine,
  moveToDocumentStart,
  moveHeadToDocumentStart,
  moveToDocumentEnd,
  moveHeadToDocumentEnd,
} from '../state/helpers/editorCursorTransformations';

export default class EditorCursorEventObserver extends EventObserver {
  private handleKeyPressArrowLeft() {
    this.taleWeaver.getState().transformEditorCursor(moveLeft());
  }

  private handleKeyPressAltArrowLeft() {
    this.taleWeaver.getState().transformEditorCursor(moveLeftByWord());
  }

  private handleKeyPressMetaArrowLeft() {
    this.taleWeaver.getState().transformEditorCursor(moveLeftByLine());
  }

  private handleKeyPressShiftArrowLeft() {
    this.taleWeaver.getState().transformEditorCursor(moveHeadLeft());
  }

  private handleKeyPressShiftAltArrowLeft() {
    this.taleWeaver.getState().transformEditorCursor(moveHeadLeftByWord());
  }

  private handleKeyPressShiftMetaArrowLeft() {
    this.taleWeaver.getState().transformEditorCursor(moveHeadLeftByLine());
  }

  private handleKeyPressArrowRight() {
    this.taleWeaver.getState().transformEditorCursor(moveRight());
  }

  private handleKeyPressAltArrowRight() {
    this.taleWeaver.getState().transformEditorCursor(moveRightByWord());
  }

  private handleKeyPressMetaArrowRight() {
    this.taleWeaver.getState().transformEditorCursor(moveRightByLine());
  }

  private handleKeyPressShiftArrowRight() {
    this.taleWeaver.getState().transformEditorCursor(moveHeadRight());
  }

  private handleKeyPressShiftAltArrowRight() {
    this.taleWeaver.getState().transformEditorCursor(moveHeadRightByWord());
  }

  private handleKeyPressShiftMetaArrowRight() {
    this.taleWeaver.getState().transformEditorCursor(moveHeadRightByLine());
  }

  private handleKeyPressArrowUp() {
    // TODO
  }

  private handleKeyPressAltArrowUp() {
    this.taleWeaver.getState().transformEditorCursor(moveLeftByLine());
  }

  private handleKeyPressMetaArrowUp() {
    this.taleWeaver.getState().transformEditorCursor(moveToDocumentStart());
  }

  private handleKeyPressShiftArrowUp() {
    // TODO
  }

  private handleKeyPressShiftAltArrowUp() {
    this.taleWeaver.getState().transformEditorCursor(moveHeadLeftByLine());
  }

  private handleKeyPressShiftMetaArrowUp() {
    this.taleWeaver.getState().transformEditorCursor(moveHeadToDocumentStart());
  }

  private handleKeyPressArrowDown() {
    // TODO
  }

  private handleKeyPressAltArrowDown() {
    this.taleWeaver.getState().transformEditorCursor(moveRightByLine());
  }

  private handleKeyPressMetaArrowDown() {
    this.taleWeaver.getState().transformEditorCursor(moveToDocumentEnd());
  }

  private handleKeyPressShiftArrowDown() {
    // TODO
  }

  private handleKeyPressShiftAltArrowDown() {
    this.taleWeaver.getState().transformEditorCursor(moveHeadRightByLine());
  }

  private handleKeyPressShiftMetaArrowDown() {
    this.taleWeaver.getState().transformEditorCursor(moveHeadToDocumentEnd());
  }

  onEvent(event: Event) {
    if (event instanceof KeyPressEvent) {
      const keyPressEvent = <KeyPressEvent> event;
      if (keyPressEvent.key === 'ArrowLeft') {
        if (keyPressEvent.shift) {
          if (keyPressEvent.alt) {
            this.handleKeyPressShiftAltArrowLeft();
          } else if (keyPressEvent.meta) {
            this.handleKeyPressShiftMetaArrowLeft();
          } else {
            this.handleKeyPressShiftArrowLeft();
          }
        } else {
          if (keyPressEvent.alt) {
            this.handleKeyPressAltArrowLeft();
          } else if (keyPressEvent.meta) {
            this.handleKeyPressMetaArrowLeft();
          } else {
            this.handleKeyPressArrowLeft();
          }
        }
      } else if (keyPressEvent.key === 'ArrowRight') {
        if (keyPressEvent.shift) {
          if (keyPressEvent.alt) {
            this.handleKeyPressShiftAltArrowRight();
          } else if (keyPressEvent.meta) {
            this.handleKeyPressShiftMetaArrowRight();
          } else {
            this.handleKeyPressShiftArrowRight();
          }
        } else {
          if (keyPressEvent.alt) {
            this.handleKeyPressAltArrowRight();
          } else if (keyPressEvent.meta) {
            this.handleKeyPressMetaArrowRight();
          } else {
            this.handleKeyPressArrowRight();
          }
        }
      } else if (keyPressEvent.key === 'ArrowUp') {
        if (keyPressEvent.shift) {
          if (keyPressEvent.alt) {
            this.handleKeyPressShiftAltArrowUp();
          } else if (keyPressEvent.meta) {
            this.handleKeyPressShiftMetaArrowUp();
          } else {
            this.handleKeyPressShiftArrowUp();
          }
        } else {
          if (keyPressEvent.alt) {
            this.handleKeyPressAltArrowUp();
          } else if (keyPressEvent.meta) {
            this.handleKeyPressMetaArrowUp();
          } else {
            this.handleKeyPressArrowUp();
          }
        }
      } else if (keyPressEvent.key === 'ArrowDown') {
        if (keyPressEvent.shift) {
          if (keyPressEvent.alt) {
            this.handleKeyPressShiftAltArrowDown();
          } else if (keyPressEvent.meta) {
            this.handleKeyPressShiftMetaArrowDown();
          } else {
            this.handleKeyPressShiftArrowDown();
          }
        } else {
          if (keyPressEvent.alt) {
            this.handleKeyPressAltArrowDown();
          } else if (keyPressEvent.meta) {
            this.handleKeyPressMetaArrowDown();
          } else {
            this.handleKeyPressArrowDown();
          }
        }
      }
    }
  }
}
