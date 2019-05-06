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
  protected mounted: boolean = false;

  constructor(editor: Editor) {
    this.editor = editor;
    const layoutManager = editor.getLayoutManager();
    const docBox = layoutManager.getDocBox();
    this.docViewNode = new DocViewNode(docBox.getID());
    this.cursorView = new CursorView(editor);
    this.presenter = new Presenter(editor, this.docViewNode);
    this.domObserver = new DOMObserver(editor);
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

  mount(domWrapper: HTMLElement) {
    if (this.mounted) {
      return;
    }
    this.presenter.mount(domWrapper);
    this.domObserver.connect(this.docViewNode);
    this.mounted = true;
  }

  focus() {
    this.domObserver.focus();
  }

  blur() {
    this.domObserver.blur();
  }
}

export default ViewManager;
