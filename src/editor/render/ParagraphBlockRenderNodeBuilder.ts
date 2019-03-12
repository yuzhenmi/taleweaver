import Paragraph from '../model/Paragraph';
import BlockRenderNodeBuilder, { Parent } from './BlockRenderNodeBuilder';
import ParagraphBlockRenderNode from './ParagraphBlockRenderNode';

export default class ParagraphBlockRenderNodeBuilder extends BlockRenderNodeBuilder {

  render(parent: Parent, paragraph: Paragraph): ParagraphBlockRenderNode {
    const paragraphBlockRenderNode = new ParagraphBlockRenderNode(parent, paragraph.getSelectableSize());
    return paragraphBlockRenderNode;
  }
}
