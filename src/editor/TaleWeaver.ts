import Config from './Config'
import Token from './flatmodel/Token';
import Doc from './treemodel/Doc';
import DocViewModel from './viewmodel/DocViewModel';
import DocView from './view/DocView';
import Cursor from './cursor/Cursor';
import CursorTransformation from './state/CursorTransformation';
import DocumentTransformation from './state/DocumentTransformation';
import Event from './event/Event';
import EventObserver from './event/EventObserver';
import CursorTransformer from './state/CursorTransformer';
import DocumentTransformer from './state/DocumentTransformer';

export default class TaleWeaver {
  protected config: Config;
  protected tokens: Token[];
  protected editorCursor: Cursor | null;
  protected doc: Doc;
  protected docViewModel: DocViewModel;
  protected docView: DocView;
  protected cursorTransformer: CursorTransformer;
  protected docTransformer: DocumentTransformer;
  protected eventObservers: EventObserver[];

  constructor(config: Config, tokens: Token[], editorCursor: Cursor | null) {
    this.config = config;
    this.tokens = tokens;
    this.editorCursor = editorCursor;
    this.doc = new Doc(this, this.tokens);
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
    this.docTransformer = new DocumentTransformer();
    this.eventObservers = config.getEventObserverClasses().map(SomeEventObserver => {
      return new SomeEventObserver(this);
    });
  }

  getConfig(): Config {
    return this.config;
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

  applyDocumentTransformation(transformation: DocumentTransformation) {
    if (!this.doc) {
      throw new Error('No document available to apply transformation.');
    }
    this.docTransformer.apply(this.doc, transformation);
  }
}
