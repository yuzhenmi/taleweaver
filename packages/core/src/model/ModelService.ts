import Editor from '../Editor';
import Doc from './DocModelNode';
import ModelEngine from './ModelEngine';

class ModelManager {
  protected editor: Editor;
  protected doc: Doc;
  protected modelEngine: ModelEngine;

  constructor(editor: Editor) {
    this.editor = editor;
    this.modelEngine = new ModelEngine(editor);
  }

  getDoc() {
    return this.doc;
  }

  toHTML(from: number, to: number) {
    return this.doc.toHTML(from, to).outerHTML;
  }

  resolveOffset(offset: number) {
    return this.doc.resolveOffset(offset);
  }
}

export default ModelManager;
