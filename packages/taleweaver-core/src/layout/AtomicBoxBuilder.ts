import AtomicRenderNode from '../render/AtomicRenderNode';
import BoxBuilder from './BoxBuilder';
import AtomicBox from './AtomicBox';

export default abstract class AtomicBoxBuilder extends BoxBuilder {

  abstract build(atomicRenderNode: AtomicRenderNode): AtomicBox;
}
