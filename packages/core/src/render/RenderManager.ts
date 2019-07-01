import Editor from '../Editor';
import DocRenderNode from './DocRenderNode';
import RenderEngine from './RenderEngine';
import { ResolvedPosition } from './RenderNode';
import TextAtomicRenderNode from './TextAtomicRenderNode';

function getLeafPosition(position: ResolvedPosition): ResolvedPosition {
  if (!position.child) {
    return position
  }
  return getLeafPosition(position.child);
}

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
    return this.docRenderNode.convertSelectableOffsetToModelOffset(selectableOffset);
  }

  resolveSelectableOffset(selectableOffset: number) {
    return this.docRenderNode.resolveSelectableOffset(selectableOffset);
  }

  getTextStyleAt(selectableOffset: number) {
    const position = this.editor.getRenderManager().resolveSelectableOffset(selectableOffset);
    const inlinePosition = getLeafPosition(position);
    const atomicRenderNode = inlinePosition.renderNode;
    if (atomicRenderNode instanceof TextAtomicRenderNode) {
      return atomicRenderNode.getTextStyle();
    }
    return null;
  }
}

export default RenderManager;
