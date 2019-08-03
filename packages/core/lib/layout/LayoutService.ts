import Editor from '../Editor';
import LayoutEngine from './LayoutEngine';

class LayoutService {
    protected editor: Editor;
    protected layoutEngine: LayoutEngine;

    constructor(editor: Editor) {
        this.editor = editor;
        this.layoutEngine = new LayoutEngine(editor);
    }

    getDoc() {
        return this.layoutEngine.getDoc();
    }

    getPages() {
        return this.layoutEngine.getDoc().getChildNodes();
    }

    resolveRects(from: number, to: number) {
        const doc = this.layoutEngine.getDoc();
        return doc.resolveRects(from, to);
    }

    resolvePosition(offset: number) {
        return this.layoutEngine.getDoc().resolvePosition(offset);
    }
}

export default LayoutService;
