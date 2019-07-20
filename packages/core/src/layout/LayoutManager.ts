import Editor from '../Editor';
import DocBox from './DocLayoutNode';
import LayoutEngine from './LayoutEngine';

class LayoutManager {
  protected editor: Editor;
  protected docBox: DocBox;
  protected layoutEngine: LayoutEngine;

  constructor(editor: Editor) {
    this.editor = editor;
    const renderManager = editor.getRenderManager();
    const docRenderNode = renderManager.getDocRenderNode();
    this.docBox = new DocBox(editor, docRenderNode.getID());
    this.layoutEngine = new LayoutEngine(editor, this.docBox);
  }

  getDocBox() {
    return this.docBox;
  }
}

export default LayoutManager;
