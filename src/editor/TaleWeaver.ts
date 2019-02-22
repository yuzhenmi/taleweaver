import Config from './Config'
import State from './state/State';
import Doc from './model/Doc';
import DocViewModel from './viewmodel/DocViewModel';
import DocView from './view/DocView';
import Cursor from './cursor/Cursor';
import CursorTransformation from './cursortransformer/CursorTransformation';
import StateTransformation from './statetransformer/StateTransformation';
import Event from './event/Event';
import EventObserver from './event/EventObserver';
import CursorTransformer from './cursortransformer/CursorTransformer';
import StateTransformer from './statetransformer/StateTransformer';

export default class TaleWeaver {
  protected config: Config;
  protected state: State;
  protected editorCursor: Cursor | null;
  protected doc: Doc;
  protected docViewModel: DocViewModel;
  protected docView: DocView;
  protected cursorTransformer: CursorTransformer;
  protected stateTransformer: StateTransformer;
  protected eventObservers: EventObserver[];

  constructor(config: Config, state: State, editorCursor: Cursor | null) {
    this.config = config;
    this.state = state;
    this.editorCursor = editorCursor;
    this.doc = new Doc(this, this.state.getTokens());
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
    this.cursorTransformer = new CursorTransformer();
    this.stateTransformer = new StateTransformer();
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

  /**
   * Applies a transformation on the editor cursor.
   * @param transformation - Cursor transformation to apply.
   */
  applyEditorCursorTransformation(transformation: CursorTransformation) {
    if (!this.editorCursor) {
      throw new Error('No editor cursor available to apply transformation.');
    }
    this.cursorTransformer.apply(this.editorCursor, transformation);
    const { domDocumentContent } = this.docView.getDOM();
  }

  applyStateTransformation(transformation: StateTransformation) {
    if (!this.doc) {
      throw new Error('No document available to apply transformation.');
    }
    this.stateTransformer.apply(this.state, transformation);
  }
}
