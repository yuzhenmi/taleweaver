import Editor from '../Editor';
import Event from './Event';
import CursorCommand from '../cursor/commands/Command';
import StateCommand from '../state/commands/Command';

export default abstract class EventObserver {
  protected editor: Editor;

  constructor(editor: Editor) {
    this.editor = editor;
  }

  dispatchCursorCommand(cursorCommand: CursorCommand) {
    const editorCursor = this.editor.getEditorCursor();
    if (!editorCursor) {
      return;
    }
    const cursorTransformation = cursorCommand(this.editor);
    editorCursor.transform(cursorTransformation);
  }

  dispatchStateCommand(stateCommand: StateCommand) {
    const stateTransformation = stateCommand(this.editor);
    this.editor.getState().transform(stateTransformation);
  }

  abstract onEvent(event: Event): void;
}
