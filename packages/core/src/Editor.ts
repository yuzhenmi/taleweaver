import Config from './Config'
import Dispatcher from './dispatch/Dispatcher';
import Cursor from './cursor/Cursor';
import TokenManager from './token/TokenManager';
import ModelManager from './model/ModelManager';
import RenderManager from './render/RenderManager';
import LayoutManager from './layout/LayoutManager';
import ViewManager from './view/ViewManager';
import Extension from './extension/Extension';
import ExtensionProvider from './extension/ExtensionProvider';

export default class Editor {
  protected config: Config;
  protected dispatcher: Dispatcher;
  protected cursor: Cursor;
  protected tokenManager: TokenManager;
  protected modelManager: ModelManager;
  protected renderManager: RenderManager;
  protected layoutManager: LayoutManager;
  protected viewManager: ViewManager;
  protected extensionProvider: ExtensionProvider;
  protected domWrapper?: HTMLElement;

  constructor(config: Config, markup: string) {
    this.config = config;
    this.dispatcher = new Dispatcher(this);
    this.cursor = new Cursor(this);
    this.tokenManager = new TokenManager(this, markup);
    this.modelManager = new ModelManager(this);
    this.renderManager = new RenderManager(this);
    this.layoutManager = new LayoutManager(this);
    this.viewManager = new ViewManager(this);
    this.extensionProvider = new ExtensionProvider(this);
  }

  getConfig() {
    return this.config;
  }

  getDispatcher() {
    return this.dispatcher;
  }

  getCursor() {
    return this.cursor;
  }

  getTokenManager() {
    return this.tokenManager;
  }

  getModelManager() {
    return this.modelManager;
  }

  getRenderManager() {
    return this.renderManager;
  }

  getLayoutManager() {
    return this.layoutManager;
  }

  getViewManager() {
    return this.viewManager;
  }

  mount(domWrapper: HTMLElement) {
    this.domWrapper = domWrapper;
    this.viewManager.mount(domWrapper);
    this.extensionProvider.onMounted();
  }

  registerExtension(extension: Extension) {
    this.extensionProvider.registerExtension(extension);
  }
}
