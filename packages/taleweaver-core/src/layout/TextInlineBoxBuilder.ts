import TextInlineRenderNode from '../render/TextInlineRenderNode';
import InlineBoxBuilder from './InlineBoxBuilder';
import TextInlineBox from './TextInlineBox';
import TextAtomicRenderNode from '../render/TextAtomicRenderNode';
import TextAtomicBox from './TextAtomicBox';
import measureText from './helpers/measureText';

const stubTextStyle = {
  fontFamily: 'Arial',
  fontSize: 18,
  fontWeight: 400,
  lineHeight: 36,
  letterSpacing: 0,
};

export default class TextInlineBoxBuilder extends InlineBoxBuilder {

  build(textInlineRenderNode: TextInlineRenderNode): TextInlineBox {
    const textInlineBox = new TextInlineBox();
    let offset = 0;
    textInlineRenderNode.getChildren().forEach(textAtomicRenderNode => {
      if (!(textAtomicRenderNode instanceof TextAtomicRenderNode)) {
        throw new Error(`Error building TextInlineBox, expecting child of TextInlineRenderNode to be TextAtomicRenderNode.`);
      }
      const textMeasurement = measureText(textAtomicRenderNode.getContent(), stubTextStyle);
      const textAtomicBox = new TextAtomicBox(
        textAtomicRenderNode.getSelectableSize(),
        textMeasurement.width,
        textMeasurement.height,
        textAtomicRenderNode.getBreakable(),
        textAtomicRenderNode.getContent(),
      );
      textInlineBox.insertChild(textAtomicBox, offset);
      offset += 1;
    });
    return textInlineBox;
  }
}
