import EventObserver from '../event/EventObserver';
import Event, { KeyPressEvent } from '../event/Event';
import { translate, translateHead, collapseBackward, collapseForward } from '../state/helpers/editorCursorTransformations';

export default class EditorCursorEventObserver extends EventObserver {
  private handleKeyPressArrowLeft() {
    const taleWeaver = this.taleWeaver;
    const state = taleWeaver.getState();
    const editorCursor = state.getEditorCursor();
    if (!editorCursor) {
      return;
    }
    const anchor = editorCursor.getAnchor();
    const head = editorCursor.getHead();
    if (anchor !== head) {
      state.transformEditorCursor(collapseBackward());
    } else {
      if (head > 0) {
        state.transformEditorCursor(translate(-1));
      }
    }
  }

  private handleKeyPressAltArrowLeft() {
    const taleWeaver = this.taleWeaver;
    const state = taleWeaver.getState();
    const editorCursor = state.getEditorCursor();
    if (!editorCursor) {
      return;
    }
    const head = editorCursor.getHead();
    const documentView = taleWeaver.getDocumentView();
    const wordStart = documentView.getWordStartPosition(head);
    state.transformEditorCursor(translate(wordStart - head));
  }

  private handleKeyPressMetaArrowLeft() {
    const taleWeaver = this.taleWeaver;
    const state = taleWeaver.getState();
    const editorCursor = state.getEditorCursor();
    if (!editorCursor) {
      return;
    }
    const head = editorCursor.getHead();
    const documentView = taleWeaver.getDocumentView();
    const lineStart = documentView.getLineStartPosition(head);
    state.transformEditorCursor(translate(lineStart - head));
  }

  private handleKeyPressShiftArrowLeft() {
    const taleWeaver = this.taleWeaver;
    const state = taleWeaver.getState();
    const editorCursor = state.getEditorCursor();
    if (!editorCursor) {
      return;
    }
    const head = editorCursor.getHead();
    if (head > 0) {
      state.transformEditorCursor(translateHead(-1));
    }
  }

  private handleKeyPressShiftAltArrowLeft() {
    const taleWeaver = this.taleWeaver;
    const state = taleWeaver.getState();
    const editorCursor = state.getEditorCursor();
    if (!editorCursor) {
      return;
    }
    const head = editorCursor.getHead();
    const documentView = taleWeaver.getDocumentView();
    const wordStart = documentView.getWordStartPosition(head);
    state.transformEditorCursor(translateHead(wordStart - head));
  }

  private handleKeyPressShiftMetaArrowLeft() {
    const taleWeaver = this.taleWeaver;
    const state = taleWeaver.getState();
    const editorCursor = state.getEditorCursor();
    if (!editorCursor) {
      return;
    }
    const head = editorCursor.getHead();
    const documentView = taleWeaver.getDocumentView();
    const lineStart = documentView.getLineStartPosition(head);
    state.transformEditorCursor(translateHead(lineStart - head));
  }

  private handleKeyPressArrowRight() {
    const taleWeaver = this.taleWeaver;
    const state = taleWeaver.getState();
    const editorCursor = state.getEditorCursor();
    if (!editorCursor) {
      return;
    }
    const anchor = editorCursor.getAnchor();
    const head = editorCursor.getHead();
    if (anchor !== head) {
      state.transformEditorCursor(collapseForward());
    } else {
      if (head < state.getDocumentElement().getSize()) {
        state.transformEditorCursor(translate(1));
      }
    }
  }

  private handleKeyPressAltArrowRight() {
    const taleWeaver = this.taleWeaver;
    const state = taleWeaver.getState();
    const editorCursor = state.getEditorCursor();
    if (!editorCursor) {
      return;
    }
    const head = editorCursor.getHead();
    const documentView = taleWeaver.getDocumentView();
    const wordEnd = documentView.getWordEndPosition(head);
    state.transformEditorCursor(translate(wordEnd - head));
  }

  private handleKeyPressMetaArrowRight() {
    const taleWeaver = this.taleWeaver;
    const state = taleWeaver.getState();
    const editorCursor = state.getEditorCursor();
    if (!editorCursor) {
      return;
    }
    const head = editorCursor.getHead();
    const documentView = taleWeaver.getDocumentView();
    const lineEnd = documentView.getLineEndPosition(head);
    state.transformEditorCursor(translate(lineEnd - head));
  }

  private handleKeyPressShiftArrowRight() {
    const taleWeaver = this.taleWeaver;
    const state = taleWeaver.getState();
    const editorCursor = state.getEditorCursor();
    if (!editorCursor) {
      return;
    }
    const head = editorCursor.getHead();
    if (head < state.getDocumentElement().getSize()) {
      state.transformEditorCursor(translateHead(1));
    }
  }

  private handleKeyPressShiftAltArrowRight() {
    const taleWeaver = this.taleWeaver;
    const state = taleWeaver.getState();
    const editorCursor = state.getEditorCursor();
    if (!editorCursor) {
      return;
    }
    const head = editorCursor.getHead();
    const documentView = taleWeaver.getDocumentView();
    const wordEnd = documentView.getWordEndPosition(head);
    state.transformEditorCursor(translateHead(wordEnd - head));
  }

  private handleKeyPressShiftMetaArrowRight() {
    const taleWeaver = this.taleWeaver;
    const state = taleWeaver.getState();
    const editorCursor = state.getEditorCursor();
    if (!editorCursor) {
      return;
    }
    const head = editorCursor.getHead();
    const documentView = taleWeaver.getDocumentView();
    const lineEnd = documentView.getLineEndPosition(head);
    state.transformEditorCursor(translateHead(lineEnd - head));
  }

  private handleKeyPressArrowUp() {
    const taleWeaver = this.taleWeaver;
    const state = taleWeaver.getState();
    const editorCursor = state.getEditorCursor();
    if (!editorCursor) {
      return;
    }
    // TODO
  }

  private handleKeyPressAltArrowUp() {
    const taleWeaver = this.taleWeaver;
    const state = taleWeaver.getState();
    const editorCursor = state.getEditorCursor();
    if (!editorCursor) {
      return;
    }
    const head = editorCursor.getHead();
    const documentView = taleWeaver.getDocumentView();
    const lineStart = documentView.getLineStartPosition(head);
    state.transformEditorCursor(translate(lineStart - head));
  }

  private handleKeyPressMetaArrowUp() {
    const taleWeaver = this.taleWeaver;
    const state = taleWeaver.getState();
    const editorCursor = state.getEditorCursor();
    if (!editorCursor) {
      return;
    }
    const head = editorCursor.getHead();
    const documentStart = 0;
    state.transformEditorCursor(translate(documentStart - head));
  }

  private handleKeyPressShiftArrowUp() {
    const taleWeaver = this.taleWeaver;
    const state = taleWeaver.getState();
    const editorCursor = state.getEditorCursor();
    if (!editorCursor) {
      return;
    }
    // TODO
  }

  private handleKeyPressShiftAltArrowUp() {
    const taleWeaver = this.taleWeaver;
    const state = taleWeaver.getState();
    const editorCursor = state.getEditorCursor();
    if (!editorCursor) {
      return;
    }
    const head = editorCursor.getHead();
    const documentView = taleWeaver.getDocumentView();
    const lineStart = documentView.getLineStartPosition(head);
    state.transformEditorCursor(translateHead(lineStart - head));
  }

  private handleKeyPressShiftMetaArrowUp() {
    const taleWeaver = this.taleWeaver;
    const state = taleWeaver.getState();
    const editorCursor = state.getEditorCursor();
    if (!editorCursor) {
      return;
    }
    const head = editorCursor.getHead();
    const documentStart = 0;
    state.transformEditorCursor(translateHead(documentStart - head));
  }

  private handleKeyPressArrowDown() {
    const taleWeaver = this.taleWeaver;
    const state = taleWeaver.getState();
    const editorCursor = state.getEditorCursor();
    if (!editorCursor) {
      return;
    }
    // TODO
  }

  private handleKeyPressAltArrowDown() {
    const taleWeaver = this.taleWeaver;
    const state = taleWeaver.getState();
    const editorCursor = state.getEditorCursor();
    if (!editorCursor) {
      return;
    }
    const head = editorCursor.getHead();
    const documentView = taleWeaver.getDocumentView();
    const lineEnd = documentView.getLineEndPosition(head);
    state.transformEditorCursor(translate(lineEnd - head));
  }

  private handleKeyPressMetaArrowDown() {
    const taleWeaver = this.taleWeaver;
    const state = taleWeaver.getState();
    const editorCursor = state.getEditorCursor();
    if (!editorCursor) {
      return;
    }
    const head = editorCursor.getHead();
    const documentView = taleWeaver.getDocumentView();
    const documentEnd = documentView.getSize();
    state.transformEditorCursor(translate(documentEnd - head));
  }

  private handleKeyPressShiftArrowDown() {
    const taleWeaver = this.taleWeaver;
    const state = taleWeaver.getState();
    const editorCursor = state.getEditorCursor();
    if (!editorCursor) {
      return;
    }
    // TODO
  }

  private handleKeyPressShiftAltArrowDown() {
    const taleWeaver = this.taleWeaver;
    const state = taleWeaver.getState();
    const editorCursor = state.getEditorCursor();
    if (!editorCursor) {
      return;
    }
    const head = editorCursor.getHead();
    const documentView = taleWeaver.getDocumentView();
    const lineEnd = documentView.getLineEndPosition(head);
    state.transformEditorCursor(translateHead(lineEnd - head));
  }

  private handleKeyPressShiftMetaArrowDown() {
    const taleWeaver = this.taleWeaver;
    const state = taleWeaver.getState();
    const editorCursor = state.getEditorCursor();
    if (!editorCursor) {
      return;
    }
    const head = editorCursor.getHead();
    const documentView = taleWeaver.getDocumentView();
    const documentEnd = documentView.getSize();
    state.transformEditorCursor(translateHead(documentEnd - head));
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
