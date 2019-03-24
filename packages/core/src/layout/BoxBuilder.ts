import RenderNode from '../render/RenderNode';
import Box from './Box';

export default abstract class BoxBuilder {

  abstract build(renderNode: RenderNode): Box;
}
