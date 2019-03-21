import InputManager from '../input/InputManager';

export default class EventObserver {
  protected inputManager: InputManager;

  constructor(inputManager: InputManager) {
    this.inputManager = inputManager;
    window.addEventListener('keydown', this.onKeyDown);
  }

  private onKeyDown = (event: KeyboardEvent) => {
    event.preventDefault();
    this.inputManager.onKeyPress(event);
  }
}
