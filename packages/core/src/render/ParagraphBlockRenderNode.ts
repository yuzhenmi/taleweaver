import Paragraph from '../model/Paragraph';
import BlockRenderNode from './BlockRenderNode';

export default class ParagraphBlockRenderNode extends BlockRenderNode {

  getType(): string {
    return 'ParagraphBlockRenderNode';
  }

  onModelUpdated(node: Paragraph) {
    this.selectableSize = undefined;
  }
}
