import Node from '../model/Node';
import Renderer from './Renderer';
import BlockRenderNode from './BlockRenderNode';
import InlineRenderNode from './InlineRenderNode';

export type Parent = BlockRenderNode;

export default abstract class InlineRenderer extends Renderer {

  abstract render(parent: Parent, node: Node): InlineRenderNode;
}
