import TextInlineRenderNode from '../render/TextInlineRenderNode';
import InlineBoxBuilder from './InlineBoxBuilder';
import TextInlineBox from './TextInlineBox';

export default class TextInlineBoxBuilder extends InlineBoxBuilder {

  build(textInlineRenderNode: TextInlineRenderNode): TextInlineBox {
    return new TextInlineBox(textInlineRenderNode.getSelectableSize());
  }
}
