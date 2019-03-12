import Text from '../model/Text';
import InlineRenderNodeBuilder, { Parent } from './InlineRenderNodeBuilder';
import TextInlineRenderNode from './TextInlineRenderNode';
import TextAtomicRenderNode from './TextAtomicRenderNode';
import breakTextToWords from './helpers/breakTextToWords';

export default class TextInlineRenderNodeBuilder extends InlineRenderNodeBuilder {

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
