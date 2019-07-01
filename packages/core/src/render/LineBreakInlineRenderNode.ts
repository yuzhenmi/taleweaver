import Editor from '../Editor';
import generateID from '../utils/generateID';
import InlineRenderNode from './InlineRenderNode';
import LineBreakAtomicRenderNode from './LineBreakAtomicRenderNode';

export default class LineBreakInlineRenderNode extends InlineRenderNode {
  protected atomicRenderNode: LineBreakAtomicRenderNode;

  constructor(editor: Editor, id: string) {
    super(editor, id);
    this.atomicRenderNode = new LineBreakAtomicRenderNode(editor, generateID());
    this.insertChild(this.atomicRenderNode);
  }

  getType(): string {
    return 'LineBreakInlineRenderNode';
  }

  bumpVersion() {
    super.bumpVersion();
    this.atomicRenderNode.bumpVersion();
  }
}
