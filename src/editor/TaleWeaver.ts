import Config from './Config'
import State from './state/State';
import Token from './state/Token';
import Doc from './model/Doc';
import DocViewModel from './layout/DocViewModel';
import DocView from './view/DocView';
import Cursor from './cursor/Cursor';
import Event from './event/Event';
import EventObserver from './event/EventObserver';
import Parser from './model/Parser';
import Tokenizer from './state/Tokenizer';

export default class TaleWeaver {
  protected config: Config;
  protected state: State;
  protected editorCursor: Cursor | null;
  protected doc: Doc;
  protected docViewModel: DocViewModel;
  protected docView: DocView;
  protected eventObservers: EventObserver[];
  protected parser: Parser;
  protected domWrapper?: HTMLElement;

  constructor(config: Config) {
    this.config = config;
    this.state = new State();
    this.editorCursor = null;
    this.doc = new Doc();
    this.docViewModel = new DocViewModel(this, this.doc);
    this.docView = new DocView(
      this,
      this.docViewModel,
      {
        pageWidth: 800,
        pageHeight: 1200,
        pagePaddingTop: 60,
        pagePaddingBottom: 60,
        pagePaddingLeft: 60,
        pagePaddingRight: 60,
      },
    );
    this.eventObservers = config.getEventObserverClasses().map(SomeEventObserver => {
      return new SomeEventObserver(this);
    });
    this.parser = new Parser(this.config, this.doc);
    this.parser.parse(this.state.getTokens());
    this.state.subscribe(this.handleStateUpdated);
  }

  getConfig(): Config {
    return this.config;
  }

  setMarkup(markup: string) {
    const tokenizer = new Tokenizer(markup);
    const tokens = tokenizer.tokenize();
    this.state.setTokens(tokens);
  }

  getState(): State {
    return this.state;
  }

  getDoc(): Doc {
    return this.doc;
  }

  getDocView(): DocView {
    return this.docView;
  }

  setEditorCursor(editorCursor: Cursor) {
    this.editorCursor = editorCursor;
  }

  getEditorCursor(): Cursor | null {
    return this.editorCursor;
  }

  mount(domWrapper: HTMLElement) {
    this.domWrapper = domWrapper;
    this.docView.mount(domWrapper);
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
