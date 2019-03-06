import Config from './Config'
import Token from './state/Token';
import Tokenizer from './state/Tokenizer';
import State from './state/State';
import Cursor from './cursor/Cursor';
import Parser from './model/Parser';
import Doc from './model/Doc';
import Renderer from './render/Renderer';
import RenderDoc from './render/RenderDoc';
import LayoutEngine from './layout/LayoutEngine';
import DocLayout from './layout/DocLayout';
import ViewAdapter from './view/ViewAdapter';
import DocView from './view/DocView';
import Event from './event/Event';
import EventObserver from './event/EventObserver';

export default class TaleWeaver {
  protected config: Config;
  protected state: State;
  protected editorCursor: Cursor | null;
  protected tokenizer: Tokenizer;
  protected parser: Parser;
  protected renderer: Renderer;
  protected layoutEngine: LayoutEngine;
  protected viewAdapter: ViewAdapter;
  protected domWrapper?: HTMLElement;
  protected eventObservers: EventObserver[];

  constructor(config: Config) {
    this.config = config;
    this.state = new State();
    this.state.subscribe(this.handleStateUpdated);
    this.editorCursor = null;
    this.tokenizer = new Tokenizer(this.config);
    this.parser = new Parser(this.config, new Doc());
    this.renderer = new Renderer(this.config, new RenderDoc());
    this.layoutEngine = new LayoutEngine(this.config, new DocLayout());
    this.viewAdapter = new ViewAdapter(this.config, new DocView());
    this.eventObservers = config.getEventObserverClasses().map(SomeEventObserver => {
      return new SomeEventObserver(this);
    });
  }

  getConfig(): Config {
    return this.config;
  }

  setMarkup(markup: string) {
    const tokens = this.tokenizer.tokenize(markup);
    this.state.setTokens(tokens);
  }

  getState(): State {
    return this.state;
  }

  setEditorCursor(editorCursor: Cursor) {
    this.editorCursor = editorCursor;
  }

  getEditorCursor(): Cursor | null {
    return this.editorCursor;
  }

  mount(domWrapper: HTMLElement) {
    this.domWrapper = domWrapper;
    this.viewAdapter.mount(domWrapper);
  }

  /**
   * Dispatches an event to the event observers.
   * @param event - Event to dispatch.
   */
  dispatchEvent(event: Event) {
    this.eventObservers.forEach(eventObserver => {
      eventObserver.onEvent(event);
    });
  }

  protected handleStateUpdated = (tokens: Token[]) => {
    this.parser.parse(tokens);
  }
}
