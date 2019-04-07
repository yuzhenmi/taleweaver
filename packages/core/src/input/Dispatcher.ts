import Editor from '../Editor';
import Command from './Command';
import KeySignature from './KeySignature';

export default class Dispatcher {
  protected editor: Editor;

  constructor(editor: Editor) {
    this.editor = editor;
  }

  dispatchCommand(command: Command) {
    const state = this.editor.getState();
    const cursor = this.editor.getCursor();
    const [
      stateTransformation,
      cursorTransformation,
    ] = command(this.editor);
    state.applyTransformation(stateTransformation);
    cursor.applyTransformation(cursorTransformation);
  }

  dispatchKeyPress(keySignature: KeySignature): boolean {
    const keyBindings = this.editor.getConfig().getKeyBindings();
    const keySignatureCode = keySignature.getCode();
    if (!keyBindings.has(keySignatureCode)) {
      return false;
    }
    const handlers = keyBindings.get(keySignatureCode)!;
    if (handlers.length === 0) {
      return false;
    }
    handlers.forEach(handler => handler());
    return true;
  }
}
