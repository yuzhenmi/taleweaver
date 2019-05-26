import Editor from '../Editor';
import DocViewNode from './DocViewNode';
import CursorView from './CursorView';
import Presenter from './Presenter';
import DOMObserver from './DOMObserver';

class ViewManager {
  protected editor: Editor;
  protected docViewNode: DocViewNode;
  protected cursorView: CursorView;
  protected presenter: Presenter;
  protected domObserver: DOMObserver;

  constructor(editor: Editor, domWrapper: HTMLElement) {
    this.editor = editor;
    const layoutManager = editor.getLayoutManager();
    const docBox = layoutManager.getDocBox();
    this.docViewNode = new DocViewNode(docBox.getID());
    this.cursorView = new CursorView(editor);
    this.presenter = new Presenter(editor, this.docViewNode, domWrapper);
    this.domObserver = new DOMObserver(editor);
    this.domObserver.connect(this.docViewNode);
  }

  getDocViewNode() {
    return this.docViewNode;
  }

  getCursorView(): CursorView {
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
