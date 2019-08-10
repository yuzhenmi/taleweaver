import Editor from '../Editor';
import CursorView from './CursorView';
import DOMObserver from './DOMObserver';
import ViewEngine from './ViewEngine';

class ViewManager {
    protected editor: Editor;
    protected viewEngine: ViewEngine;
    protected domObserver: DOMObserver;
    protected cursorView: CursorView;

    constructor(editor: Editor) {
        this.editor = editor;
        this.viewEngine = new ViewEngine(editor);
        this.domObserver = new DOMObserver(editor);
        this.cursorView = new CursorView(editor);
    }

    attachToDOM(domContainer: HTMLElement) {
        this.viewEngine.attachToDOM(domContainer);
        this.domObserver.connect();
    }

    getDoc() {
        return this.viewEngine.getDoc();
    }

    getPages() {
        return this.viewEngine.getDoc().getChildNodes();
    }

    getCursorView() {
        return this.cursorView;
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
