import Editor from '../Editor';
import Doc from './Doc';
import Parser from './Parser';

class ModelManager {
  protected editor: Editor;
  protected doc: Doc;
  protected parser: Parser;

  constructor(editor: Editor) {
    this.editor = editor;
    this.doc = new Doc(editor);
    this.parser = new Parser(editor, this.doc);
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
