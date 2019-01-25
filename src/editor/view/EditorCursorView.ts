import Cursor from '../cursor/Cursor';
import DocumentView from './DocumentView';

export default class EditorCursorView {
  private editorCursor?: Cursor;
  private documentView?: DocumentView;
  private domElement?: HTMLElement;

  private updateScreenPosition() {
    const editorCursor = this.editorCursor!;
    const head = editorCursor.getHead();
    const documentScreenPositions = this.documentView!.getScreenPositions(head, head);
    const { pageView, pageViewScreenPositions } = documentScreenPositions[0];
    const pageViewDOMElement = pageView.getDOMElement();
    const domElement = this.domElement!;
    domElement.style.left = `${pageViewScreenPositions[0].left + pageView.getConfig().paddingLeft}px`;
    domElement.style.top = `${pageViewScreenPositions[0].top + pageView.getConfig().paddingTop}px`;
    domElement.style.height = `${pageViewScreenPositions[0].height}px`;
    if (!domElement.parentElement) {
      pageViewDOMElement.appendChild(domElement);
    } else if (domElement.parentElement !== pageViewDOMElement) {
      domElement.parentElement!.removeChild(this.domElement!);
    }
  }

  setEditorCursor(editorCursor: Cursor) {
    this.editorCursor = editorCursor;
  }

  setDocumentView(documentView: DocumentView) {
    this.documentView = documentView;
  }

  addToDOM() {
    if (this.domElement) {
      return;
    }
    this.domElement = document.createElement('div');
    this.domElement.className = 'tw--editor-cursor';
    this.domElement.style.position = 'absolute';
    this.domElement.style.width = '2px';
    this.domElement.style.marginLeft = '-1px';
    this.domElement.style.background = 'rgba(0, 0, 0, 0.85)';
    this.updateScreenPosition();
  }

  getEditorCursor(): Cursor {
    return this.editorCursor!;
  }

  getDocumentView(): DocumentView {
    return this.documentView!;
  }
}
