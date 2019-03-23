import {
  Extension,
  StateCommand,
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

  protected dispatchCommand(command: StateCommand) {
    const editor = this.getEditor();
    const transformation = command(editor);
    editor.getState().applyTransformation(transformation);
  }
}
