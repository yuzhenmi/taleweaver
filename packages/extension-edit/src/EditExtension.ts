import {
  Extension,
  Command,
} from '@taleweaver/core';
import {
  insertChar,
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
    inputManager.subscribeOnCharInput(this.onCharInput);
  }

  protected onCharInput = (char: string) => {
    this.dispatchCommand(insertChar(this, char));
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
