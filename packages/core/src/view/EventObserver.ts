import Presenter from './Presenter';
import InputManager from '../input/InputManager';

export default class EventObserver {
  protected presenter: Presenter;
  protected inputManager: InputManager;
  protected mutationObserver: MutationObserver;
  protected isFocused: boolean;
  protected isMouseDown: boolean;

  constructor(presenter: Presenter, inputManager: InputManager) {
    this.presenter = presenter;
    this.inputManager = inputManager;
    this.mutationObserver = new MutationObserver(this.onMutated);
    this.isFocused = false;
    this.isMouseDown = false;
    const docViewDOMContainer = presenter.getDocViewNode().getDOMContainer();
    docViewDOMContainer.addEventListener('focus', this.onFocus);
    docViewDOMContainer.addEventListener('blur', this.onBlur);
    docViewDOMContainer.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);
    document.addEventListener('selectionchange', this.onSelectionChange);
    window.addEventListener('keydown', this.onKeyDown);
    this.mutationObserver.observe(presenter.getDocViewNode().getDOMContainer(), {
      attributeOldValue: true,
      attributes: true,
      characterData: true,
      characterDataOldValue: true,
      childList: true,
      subtree: true,
    });
  }

  protected onFocus = (event: FocusEvent) => {
    this.isFocused = true;
  }

  protected onBlur = (event: FocusEvent) => {
    this.isFocused = false;
  }

  protected onMouseDown = (event: MouseEvent) => {
    this.isMouseDown = true;
    const offset = this.presenter.resolveScreenPosition(event.clientX, event.clientY);
    if (offset < 0) {
      return;
    }
    this.inputManager.onCursorUpdated(offset, offset);
  }

  protected onMouseMove = (event: MouseEvent) => {
    if (!this.isMouseDown) {
      return;
    }
    const offset = this.presenter.resolveScreenPosition(event.clientX, event.clientY);
    if (offset < 0) {
      return;
    }
    this.inputManager.onCursorHeadUpdated(offset);
  }

  protected onMouseUp = (event: MouseEvent) => {
    this.isMouseDown = false;
  }

  protected onSelectionChange = () => {
    if (!this.isFocused) {
      return;
    }
    if (this.isMouseDown) {
      return;
    }
    const selection = getSelection();
    const anchor = this.presenter.resolveSelectionPosition(selection.anchorNode, selection.anchorOffset);
    const head = this.presenter.resolveSelectionPosition(selection.focusNode, selection.focusOffset);
    if (anchor < 0 || head < 0) {
      return;
    }
    this.inputManager.onCursorUpdated(anchor, head);
  }

  protected onKeyDown = (event: KeyboardEvent) => {
    this.inputManager.onKeyPress(event);
  }

  protected onMutated = (mutations: MutationRecord[], observer: MutationObserver) => {
    mutations.forEach(mutation => this.handleMutation(mutation));
  }

  protected handleMutation(mutation: MutationRecord) {
  }
}
