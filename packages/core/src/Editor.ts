import Config from './Config'
import Tokenizer from './state/Tokenizer';
import State from './state/State';
import Parser from './model/Parser';
import RenderEngine from './render/RenderEngine';
import LayoutEngine from './layout/LayoutEngine';
import Presenter from './view/Presenter';
import InputManager from './input/InputManager';
import Extension from './extension/Extension';
import ExtensionProvider from './extension/ExtensionProvider';
import Cursor from './cursor/Cursor';

export default class Editor {
  protected config: Config;
  protected cursor: Cursor;
  protected state: State;
  protected tokenizer: Tokenizer;
  protected parser: Parser;
  protected renderEngine: RenderEngine;
  protected layoutEngine: LayoutEngine;
  protected presenter: Presenter;
  protected inputManager: InputManager;
  protected extensionProvider: ExtensionProvider;
  protected domWrapper?: HTMLElement;

  constructor(config: Config, markup: string) {
    this.config = config;
    this.cursor = new Cursor(this);
    this.tokenizer = new Tokenizer(this.config, markup);
    this.state = this.tokenizer.getState();
    this.parser = new Parser(this.config, this.state);
    this.renderEngine = new RenderEngine(this.config, this.parser.getDoc());
    this.layoutEngine = new LayoutEngine(this.config, this.renderEngine.getDocRenderNode());
    this.inputManager = new InputManager();
    this.presenter = new Presenter(this.config, this.layoutEngine.getDocBox(), this.inputManager);
    this.extensionProvider = new ExtensionProvider(this);
  }

  getConfig(): Config {
    return this.config;
  }

  getCursor(): Cursor {
    return this.cursor;
  }

  getState(): State {
    return this.state;
  }

  getLayoutEngine(): LayoutEngine {
    return this.layoutEngine;
  }

  getPresenter(): Presenter {
    return this.presenter;
  }

  getInputManager(): InputManager {
    return this.inputManager;
  }

  mount(domWrapper: HTMLElement) {
    this.domWrapper = domWrapper;
    this.presenter.mount(domWrapper);
    this.extensionProvider.onMounted();
  }

  registerExtension(extension: Extension) {
    this.extensionProvider.registerExtension(extension);
  }
}
