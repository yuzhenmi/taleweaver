import Editor from '../Editor';
import LayoutEngine from './LayoutEngine';

class LayoutService {
    protected editor: Editor;
    protected layoutEngine: LayoutEngine;

    constructor(editor: Editor) {
        this.editor = editor;
        this.layoutEngine = new LayoutEngine(editor);
    }

    getDocBox() {
        return this.layoutEngine.getDoc();
    }
}

export default LayoutService;
