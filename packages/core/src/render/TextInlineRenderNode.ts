import Text from '../model/Text';
import breakTextToWords from './helpers/breakTextToWords';
import InlineRenderNode from './InlineRenderNode';
import TextAtomicRenderNode from './TextAtomicRenderNode';

export default class TextInlineRenderNode extends InlineRenderNode {

  getType(): string {
    return 'TextInlineRenderNode';
  }

  onModelUpdated(node: Text) {
    super.onModelUpdated(node);
    this.children = [];
    const words = breakTextToWords(node.getContent());
    words.forEach((word, wordOffset) => {
      const atomicRenderNode = new TextAtomicRenderNode(`${node.getID()}-${wordOffset}`, this, word.text, word.breakable);
      this.children.push(atomicRenderNode);
    });
  }
}
