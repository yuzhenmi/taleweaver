import ParagraphBlockRenderNode from '../render/ParagraphBlockRenderNode';
import LineBoxBuilder from './LineBoxBuilder';
import ParagraphLineBox from './ParagraphLineBox';

export default class ParagraphLineBoxBuilder extends LineBoxBuilder {

  build(paragraphBlockRenderNode: ParagraphBlockRenderNode): ParagraphLineBox {
    return new ParagraphLineBox();
  }
}
