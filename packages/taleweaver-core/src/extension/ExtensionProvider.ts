import LayoutEngine from '../layout/LayoutEngine';
import ViewportBoundingRect from '../layout/ViewportBoundingRect';
import Presenter from '../view/Presenter';
import InputManager, { KeySignatureSubscriber } from '../input/InputManager';
import KeySignature from '../input/KeySignature';
import DocLayout from '../layout/DocLayout';
import Extension from './Extension';

export default class ExtensionProvider {
  protected layoutEngine: LayoutEngine;
  protected presenter: Presenter;
  protected inputManager: InputManager;
  protected extensions: Extension[];

  constructor(layoutEngine: LayoutEngine, presenter: Presenter, inputManager: InputManager) {
    this.layoutEngine = layoutEngine;
    this.presenter = presenter;
    this.inputManager = inputManager;
    this.extensions = [];
    layoutEngine.subscribeOnReflowed(this.handleReflowed);
    presenter.subscribeOnMounted(this.handleReflowed);
  }

  registerExtension(extension: Extension) {
    this.extensions.push(extension);
    extension.$onRegistered(this);
  }

  getDocLayout(): DocLayout {
    return this.layoutEngine.getDocLayout();
  }

  subscribeOnKeyboardInput(keySignature: KeySignature, subscriber: KeySignatureSubscriber) {
    this.inputManager.subscribeOnKeyboardInput(keySignature, subscriber);
  }

  getPageDOMContentContainer(pageOffset: number): HTMLDivElement {
    return this.presenter.getPageDOMContentContainer(pageOffset);
  }

  private handleReflowed = () => {
    this.extensions.forEach(extension => {
      if (!extension.onReflowed) {
        return;
      }
      extension.onReflowed();
    });
  }
}
