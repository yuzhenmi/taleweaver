import TextInlineRenderNode from '../render/TextInlineRenderNode';
import InlineBoxBuilder from './InlineBoxBuilder';
import TextInlineBox from './TextInlineBox';
import TextAtomicRenderNode from '../render/TextAtomicRenderNode';
import TextAtomicBox from './TextAtomicBox';

export default class TextInlineBoxBuilder extends InlineBoxBuilder {

  build(textInlineRenderNode: TextInlineRenderNode): TextInlineBox {
    const textInlineBox = new TextInlineBox(textInlineRenderNode.getID());
    let offset = 0;
    textInlineRenderNode.getChildren().forEach(textAtomicRenderNode => {
      if (!(textAtomicRenderNode instanceof TextAtomicRenderNode)) {
        throw new Error(`Error building TextInlineBox, expecting child of TextInlineRenderNode to be TextAtomicRenderNode.`);
      }
      const textAtomicBox = new TextAtomicBox(
        textInlineRenderNode.getID(),
        textAtomicRenderNode.getBreakable(),
        textAtomicRenderNode.getContent(),
      );
      textInlineBox.insertChild(textAtomicBox, offset);
      offset += 1;
    });
    return textInlineBox;
  }
}
