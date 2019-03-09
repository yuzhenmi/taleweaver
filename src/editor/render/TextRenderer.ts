import Text from '../model/Text';
import InlineRenderer, { Parent } from './InlineRenderer';
import TextInlineRenderNode from './TextInlineRenderNode';
import TextAtomicRenderNode from './TextAtomicRenderNode';
import breakTextToWords from './helpers/breakTextToWords';

export default class TextRenderer extends InlineRenderer {

  render(parent: Parent, text: Text): TextInlineRenderNode {
    const textInlineRenderNode = new TextInlineRenderNode(parent, text.getSelectableSize());
    let offset = 0;
    const words = breakTextToWords(text.getContent());
    words.forEach(word => {
      const textAtomicRenderNode = new TextAtomicRenderNode(textInlineRenderNode, word.text, word.breakable);
      textInlineRenderNode.insertChild(textAtomicRenderNode, offset);
      offset += 1;
    });
    return textInlineRenderNode;
  }
}
