import Config from './Config'
import Tokenizer from './state/Tokenizer';
import State from './state/State';
import Cursor from './cursor/Cursor';
import Parser from './model/Parser';
import RenderEngine from './render/RenderEngine';
import LayoutEngine from './layout/LayoutEngine';
import ViewAdapter from './view/ViewAdapter';
import Event from './event/Event';
import EventObserver from './event/EventObserver';

export default class TaleWeaver {
  protected config: Config;
  protected state: State;
  protected editorCursor: Cursor | null;
  protected tokenizer: Tokenizer;
  protected parser: Parser;
  protected renderEngine: RenderEngine;
  protected layoutEngine: LayoutEngine;
  protected viewAdapter: ViewAdapter;
  protected domWrapper?: HTMLElement;
  protected eventObservers: EventObserver[];

  constructor(config: Config, markup: string) {
    this.config = config;
    this.editorCursor = null;
    this.tokenizer = new Tokenizer(this.config, markup);
    this.state = this.tokenizer.getState();
    this.parser = new Parser(this.config, this.state);
    this.renderEngine = new RenderEngine(this.config, this.parser.getDoc());
    this.layoutEngine = new LayoutEngine(this.config, this.renderEngine.getDocRenderNode());
    console.log(this.layoutEngine.getDocLayout());
    this.viewAdapter = new ViewAdapter(this.config, this.layoutEngine.getDocLayout());
    this.eventObservers = config.getEventObserverClasses().map(SomeEventObserver => {
      return new SomeEventObserver(this);
    });
  }

  getConfig(): Config {
    return this.config;
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
}
