import Editor from '../Editor';
import DocRenderNode from './DocRenderNode';
import RenderEngine from './RenderEngine';

class RenderManager {
  protected editor: Editor;
  protected docRenderNode: DocRenderNode;
  protected renderEngine: RenderEngine;

  constructor(editor: Editor) {
    this.editor = editor;
    const pageConfig = editor.getConfig().getPageConfig();
    const modelManager = editor.getModelManager();
    const doc = modelManager.getDoc();
    this.docRenderNode = new DocRenderNode(
      doc.getID(),
      pageConfig.getPageWidth(),
      pageConfig.getPageHeight(),
      pageConfig.getPagePaddingTop(),
    );
    this.renderEngine = new RenderEngine(editor, this.docRenderNode);
  }

  getDocRenderNode() {
    return this.docRenderNode;
  }

  convertSelectableOffsetToModelOffset(selectableOffset: number): number {
    return this.docRenderNode.convertSelectableOffsetToModelOffset(selectableOffset);
  }
}

export default RenderManager;
