import Editor from '../Editor';
import DocRenderNode from './DocRenderNode';
import RenderEngine from './RenderEngine';

class RenderManager {
  protected editor: Editor;
  protected docRenderNode: DocRenderNode;
  protected renderEngine: RenderEngine;

  constructor(editor: Editor) {
    this.editor = editor;
    const modelManager = editor.getModelManager();
    const doc = modelManager.getDoc();
    this.docRenderNode = new DocRenderNode(editor, doc.getID());
    this.renderEngine = new RenderEngine(editor, this.docRenderNode);
  }

  getDocRenderNode() {
    return this.docRenderNode;
  }

  convertSelectableOffsetToModelOffset(selectableOffset: number): number {
    console.log('CONVERTING', selectableOffset);
    const offset = this.docRenderNode.convertSelectableOffsetToModelOffset(selectableOffset);
    console.log(offset);
    return offset;
  }
}

export default RenderManager;
