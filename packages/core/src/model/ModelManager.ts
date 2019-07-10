import Editor from '../Editor';
import getInlinePosition from './utils/getInlinePosition';
import Doc from './Doc';
import Parser from './Parser';
import InlineElement from './InlineElement';

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

  getInlineNodesBetween(from: number, to: number) {
    const nodes: InlineElement[] = [];
    const min = Math.min(from, to);
    const max = Math.max(from, to);
    const modelManager = this.editor.getModelManager();
    const fromPosition = modelManager.resolveOffset(min);
    const toPosition = modelManager.resolveOffset(max);
    const fromNode = getInlinePosition(fromPosition).element as InlineElement;
    const toNode = getInlinePosition(toPosition).element as InlineElement;
    let node = fromNode;
    while (true) {
      nodes.push(node);
      if (node === toNode) {
        break;
      }
      const nextNode = node.getNextSibling();
      if (!nextNode) {
        break;
      }
      node = nextNode;
    }
    return nodes;
  }
}

export default ModelManager;
