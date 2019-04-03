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
  breakLine,
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
    inputManager.subscribeOnKeyPress(new KeySignature(keys.BackspaceKey), this.onBackspaceKeyPressed);
    inputManager.subscribeOnKeyPress(new KeySignature(keys.DeleteKey), this.onDeleteKeyPressed);
    inputManager.subscribeOnKeyPress(new KeySignature(keys.EnterKey), this.onEnterKeyPressed);
  }

  protected onCharInputed = (char: string) => {
    this.dispatchCommand(insertChar(this, char));
  }

  protected onBackspaceKeyPressed = () => {
    this.dispatchCommand(deleteBackward(this));
  }

  protected onDeleteKeyPressed = () => {
    this.dispatchCommand(deleteForward(this));
  }

  protected onEnterKeyPressed = () => {
    this.dispatchCommand(breakLine(this));
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
