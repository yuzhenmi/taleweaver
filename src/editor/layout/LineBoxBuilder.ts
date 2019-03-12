import BlockRenderNode from '../render/BlockRenderNode';
import BoxBuilder from './BoxBuilder';
import LineBox from './LineBox';

export default abstract class LineBoxBuilder extends BoxBuilder {

  abstract build(blockRenderNode: BlockRenderNode): LineBox;
}
