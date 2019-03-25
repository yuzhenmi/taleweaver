import Paragraph from '../model/Paragraph';
import BlockRenderNodeBuilder, { Parent } from './BlockRenderNodeBuilder';
import ParagraphBlockRenderNode from './ParagraphBlockRenderNode';

export default class ParagraphBlockRenderNodeBuilder extends BlockRenderNodeBuilder {

  build(parent: Parent, paragraph: Paragraph): ParagraphBlockRenderNode {
    const paragraphBlockRenderNode = new ParagraphBlockRenderNode(paragraph.getID(), parent, paragraph.getSelectableSize(), parent.getInnerWidth());
    return paragraphBlockRenderNode;
  }
}
