import ParagraphBlockRenderNode from '../render/ParagraphBlockRenderNode';
import BlockBoxBuilder from './BlockBoxBuilder';
import ParagraphBlockBox from './ParagraphBlockBox';

export default class ParagraphBoxBuilder extends BlockBoxBuilder {

  build(paragraphBlockRenderNode: ParagraphBlockRenderNode): ParagraphBlockBox {
    return new ParagraphBlockBox(paragraphBlockRenderNode.getID(), 1000);
  }
}
