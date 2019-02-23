import Config from './Config'
import State from './state/State';
import Doc from './model/Doc';
import DocViewModel from './viewmodel/DocViewModel';
import DocView from './view/DocView';
import Cursor from './cursor/Cursor';
import Event from './event/Event';
import EventObserver from './event/EventObserver';

export default class TaleWeaver {
  protected config: Config;
  protected state: State;
  protected editorCursor: Cursor | null;
  protected doc: Doc;
  protected docViewModel: DocViewModel;
  protected docView: DocView;
  protected eventObservers: EventObserver[];
  protected domWrapper?: HTMLElement;

  constructor(config: Config, state: State, editorCursor: Cursor | null) {
    this.config = config;
    this.state = state;
    this.editorCursor = editorCursor;
    this.doc = new Doc(this, this.state);
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
  }

  foo() {
    this.domWrapper!.innerHTML = '';
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
    this.eventObservers = this.config.getEventObserverClasses().map(SomeEventObserver => {
      return new SomeEventObserver(this);
    });
    this.mount(this.domWrapper!);
  }

  getConfig(): Config {
    return this.config;
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
}
