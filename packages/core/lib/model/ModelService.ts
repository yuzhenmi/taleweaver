import Editor from '../Editor';
import ModelEngine from './ModelEngine';

export default class ModelService {
    protected editor: Editor;
    protected modelEngine: ModelEngine;

    constructor(editor: Editor) {
        this.editor = editor;
        this.modelEngine = new ModelEngine(editor);
    }

    getDoc() {
        return this.modelEngine.getDoc();
    }

    toHTML(from: number, to: number) {
        return this.getDoc().toHTML(from, to).outerHTML;
    }

    resolvePosition(offset: number) {
        return this.getDoc().resolvePosition(offset);
    }
}
