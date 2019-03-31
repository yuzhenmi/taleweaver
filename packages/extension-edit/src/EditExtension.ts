import {
  Extension,
  Command,
  KeySignature,
  keys,
} from '@taleweaver/core';
import {
  insertChar,
  deleteBackward,
  deleteForward,
} from './commands';

export default class EditExtension extends Extension {

  constructor() {
    super();
  }

  onRegistered() {
    this.subscribeOnInputs();
  }

  onMounted() {
  }

  protected subscribeOnInputs() {
    const inputManager = this.getEditor().getInputManager();
    inputManager.subscribeOnCharInput(this.onCharInputed);
    inputManager.subscribeOnKeyPress(new KeySignature(keys.BackspaceKey), this.onBackspacePressed);
    inputManager.subscribeOnKeyPress(new KeySignature(keys.DeleteKey), this.onDeletePressed);
  }

  protected onCharInputed = (char: string) => {
    this.dispatchCommand(insertChar(this, char));
  }

  protected onBackspacePressed = () => {
    this.dispatchCommand(deleteBackward(this));
  }

  protected onDeletePressed = () => {
    this.dispatchCommand(deleteForward(this));
  }

  protected dispatchCommand(command: Command) {
    const editor = this.getEditor();
    const [
      stateTransformation,
      cursorTransformation,
    ] = command(editor);
    editor.getState().applyTransformation(stateTransformation);
    editor.getCursor().applyTransformation(cursorTransformation);
  }
}
