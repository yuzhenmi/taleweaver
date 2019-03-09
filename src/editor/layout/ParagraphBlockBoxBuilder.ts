import RenderParagraph from '../render/RenderParagraph';
import BlockBoxBuilder from './BlockBoxBuilder';
import ParagraphBlockBox from './ParagraphBlockBox';

export default class ParagraphBoxBuilder extends BlockBoxBuilder {

  build(renderParagraph: RenderParagraph): ParagraphBlockBox {
    return new ParagraphBlockBox();
  }
}
