import InlineRenderNode from '../render/InlineRenderNode';
import BoxBuilder from './BoxBuilder';
import InlineBox from './InlineBox';

export default abstract class InlineBoxBuilder extends BoxBuilder {

  abstract build(inlineRenderNode: InlineRenderNode): InlineBox;
}
