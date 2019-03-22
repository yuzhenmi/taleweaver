import { Extension } from '@taleweaver/core';

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
    // TODO: Insert char to document at cursor position
  }
}
