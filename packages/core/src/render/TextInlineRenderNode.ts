import generateID from '../helpers/generateID';
import Text from '../model/Text';
import breakTextToWords, { Word } from './helpers/breakTextToWords';
import InlineRenderNode from './InlineRenderNode';
import TextAtomicRenderNode from './TextAtomicRenderNode';

export default class TextInlineRenderNode extends InlineRenderNode {

  getType(): string {
    return 'TextInlineRenderNode';
  }

  onModelUpdated(element: Text) {
    super.onModelUpdated(element);
    const words = breakTextToWords(element.getContent());
    let offset = 0;
    words.forEach(word => {
      let atomOffset = -1;
      for (let n = offset, nn = this.children.length; n < nn; n++) {
        const child = this.children[n] as TextAtomicRenderNode;
        if (child.getContent() === word.text && child.getBreakable() === word.breakable) {
          atomOffset = n;
          break;
        }
      }
      if (atomOffset < 0) {
        const atomicRenderNode = new TextAtomicRenderNode(`${element.getID()}-${generateID()}`, this, word.text, word.breakable);
        atomicRenderNode.setVersion(this.version + 1);
        this.children.splice(offset, 0, atomicRenderNode);
      } else {
        this.children.splice(offset, atomOffset - offset);
      }
      offset++;
    });
    if (offset < this.children.length) {
      this.children.splice(offset, this.children.length - offset);
    }
  }
}
