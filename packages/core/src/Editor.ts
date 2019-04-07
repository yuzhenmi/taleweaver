import Config from './Config'
import Tokenizer from './state/Tokenizer';
import State from './state/State';
import Parser from './model/Parser';
import RenderEngine from './render/RenderEngine';
import LayoutEngine from './layout/LayoutEngine';
import Presenter from './view/Presenter';
import Dispatcher from './input/Dispatcher';
import Extension from './extension/Extension';
import ExtensionProvider from './extension/ExtensionProvider';
import Cursor from './cursor/Cursor';
import DocViewNode from './view/DocViewNode';

export default class Editor {
  protected config: Config;
  protected cursor: Cursor;
  protected state: State;
  protected dispatcher: Dispatcher;
  protected tokenizer: Tokenizer;
  protected parser: Parser;
  protected renderEngine: RenderEngine;
  protected layoutEngine: LayoutEngine;
  protected presenter: Presenter;
  protected extensionProvider: ExtensionProvider;
  protected domWrapper?: HTMLElement;

  constructor(config: Config, markup: string) {
    this.config = config;
    this.cursor = new Cursor(this);
    this.tokenizer = new Tokenizer(this.config, markup);
    this.state = this.tokenizer.getState();
    this.dispatcher = new Dispatcher(this);
    this.parser = new Parser(this.config, this.state);
    this.renderEngine = new RenderEngine(this.config, this.parser.getDoc());
    this.layoutEngine = new LayoutEngine(this.config, this.renderEngine.getDocRenderNode());
    this.presenter = new Presenter(this);
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

  getDispatcher(): Dispatcher {
    return this.dispatcher;
  }

  getDocViewNode(): DocViewNode {
    return this.presenter.getDocViewNode();
  }

  getRenderEngine(): RenderEngine {
    return this.renderEngine;
  }

  getLayoutEngine(): LayoutEngine {
    return this.layoutEngine;
  }

  getPresenter(): Presenter {
    return this.presenter;
  }

  mount(domWrapper: HTMLElement) {
    this.domWrapper = domWrapper;
    this.presenter.mount(domWrapper);
    this.extensionProvider.onMounted();
  }

  registerExtension(extension: Extension) {
    this.extensionProvider.registerExtension(extension);
  }

  convertSelectableOffsetToModelOffset(selectableOffset: number): number {
    return this.renderEngine.getDocRenderNode().convertSelectableOffsetToModelOffset(selectableOffset);
  }
}
