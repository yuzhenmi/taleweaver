import Presenter from './Presenter';
import InputManager from '../input/InputManager';

export default class EventObserver {
  protected presenter: Presenter;
  protected inputManager: InputManager;

  constructor(presenter: Presenter, inputManager: InputManager) {
    this.presenter = presenter;
    this.inputManager = inputManager;
    window.addEventListener('keydown', this.onKeyDown);
  }

  protected onKeyDown = (event: KeyboardEvent) => {
    this.inputManager.onKeyPress(event);
  }
}
