import Config from './Config'
import Dispatcher from './dispatch/Dispatcher';
import Transformer from './transform/Transformer';
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
  protected transformer: Transformer;
  protected cursor: Cursor;
  protected tokenManager: TokenManager;
  protected modelManager: ModelManager;
  protected renderManager: RenderManager;
  protected layoutManager: LayoutManager;
  protected viewManager: ViewManager;
  protected extensionProvider: ExtensionProvider;

  constructor(config: Config, markup: string, domWrapper: HTMLElement) {
    this.config = config;
    this.dispatcher = new Dispatcher(this);
    this.transformer = new Transformer(this);
    this.cursor = new Cursor(this);
    this.tokenManager = new TokenManager(this, markup);
    this.modelManager = new ModelManager(this);
    this.renderManager = new RenderManager(this);
    this.layoutManager = new LayoutManager(this);
    this.viewManager = new ViewManager(this, domWrapper);
    this.extensionProvider = new ExtensionProvider(this);
    setTimeout(() => this.getViewManager().focus());
  }

  getConfig() {
    return this.config;
  }

  getDispatcher() {
    return this.dispatcher;
  }

  getTransformer() {
    return this.transformer;
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

  registerExtension(extension: Extension) {
    this.extensionProvider.registerExtension(extension);
  }
}
