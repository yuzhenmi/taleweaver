import Editor from '../Editor';
import HistoryEngine from './HistoryEngine';

export default class HistoryService {
    protected editor: Editor;
    protected historyEngine: HistoryEngine;

    constructor(editor: Editor) {
        this.editor = editor;
        this.historyEngine = new HistoryEngine(editor);
    }

    undo() {
        this.historyEngine.undo();
    }

    redo() {
        this.historyEngine.redo();
    }
}
