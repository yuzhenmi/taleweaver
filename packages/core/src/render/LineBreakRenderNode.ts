import Editor from '../Editor';
import BlockNode from './BlockRenderNode';
import InlineNode from './InlineRenderNode';
import LineBreakAtomicRenderNode from './LineBreakAtomicRenderNode';

export type ParentNode = BlockNode;
export type ChildNode = LineBreakAtomicRenderNode;

export default class LineBreakRenderNode extends InlineNode {
  protected lineBreakAtomicNode: LineBreakAtomicRenderNode;

  constructor(editor: Editor, blockNodeID: string) {
    super(editor, `${blockNodeID}-LineBreak`);
    this.lineBreakAtomicNode = new LineBreakAtomicRenderNode(editor, blockNodeID);
  }

  getType(): string {
    return 'LineBreak';
  }

  getModelSize() {
    return 0;
  }
}
