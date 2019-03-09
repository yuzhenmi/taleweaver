import BlockRenderNode from '../render/BlockRenderNode';
import BoxBuilder from './BoxBuilder';
import BlockBox from './BlockBox';

export default abstract class BlockBoxBuilder extends BoxBuilder {

  abstract build(blockRenderNode: BlockRenderNode): BlockBox;
}
