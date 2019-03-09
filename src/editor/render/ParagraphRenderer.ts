import Paragraph from '../model/Paragraph';
import BlockRenderer, { Parent } from './BlockRenderer';
import ParagraphBlockRenderNode from './ParagraphBlockRenderNode';

export default class ParagraphRenderer extends BlockRenderer {

  render(parent: Parent, paragraph: Paragraph): ParagraphBlockRenderNode {
    const paragraphBlockRenderNode = new ParagraphBlockRenderNode(parent, paragraph.getSelectableSize());
    return paragraphBlockRenderNode;
  }
}
