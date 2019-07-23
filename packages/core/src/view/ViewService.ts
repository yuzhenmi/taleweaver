import Editor from '../Editor';
import CursorView from './CursorView';
import DocViewNode from './DocViewNode';
import DOMObserver from './DOMObserver';
import ViewEngine from './ViewEngine';

class ViewManager {
  protected editor: Editor;
  protected docViewNode: DocViewNode;
  protected cursorView: CursorView;
  protected viewEngine: ViewEngine;
  protected domObserver: DOMObserver;

  constructor(editor: Editor, domWrapper: HTMLElement) {
    this.editor = editor;
    const layoutManager = editor.getLayoutManager();
    const docBox = layoutManager.getDocBox();
    this.docViewNode = new DocViewNode(editor, docBox.getID());
    this.viewEngine = new viewEngine(editor, this.docViewNode, domWrapper);
    this.domObserver = new DOMObserver(editor);
    this.domObserver.connect(this.docViewNode);
    this.cursorView = new CursorView(editor);
  }

  getDocViewNode() {
    return this.docViewNode;
  }

  getCursorView() {
    return this.cursorView;
  }

  getPageViewNodes() {
    return this.docViewNode.getChildren();
  }

  getIsFocused() {
    return this.domObserver.getIsFocused();
  }

  focus() {
    this.domObserver.focus();
  }

  blur() {
    this.domObserver.blur();
  }
}

export default ViewManager;
