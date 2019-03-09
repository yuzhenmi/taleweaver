import TextAtomicRenderNode from '../render/TextAtomicRenderNode';
import AtomicBoxBuilder from './AtomicBoxBuilder';
import TextAtomicBox from './TextAtomicBox';
import measureText from './helpers/measureText';

const stubTextStyle = {
  fontFamily: 'Arial',
  fontSize: 12,
  fontWeight: 400,
  lineHeight: 12,
  letterSpacing: 0,
};

export default class TextAtomicBoxBuilder extends AtomicBoxBuilder {

  build(textAtomicRenderNode: TextAtomicRenderNode): TextAtomicBox {
    const textMeasurement = measureText(textAtomicRenderNode.getContent(), stubTextStyle);
    return new TextAtomicBox(textMeasurement.width, textMeasurement.height);
  }
}
