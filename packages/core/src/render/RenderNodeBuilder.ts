import Node from '../model/Node';
import RenderNode from './RenderNode';

export default abstract class RenderNodeBuilder {

  abstract build(parent: RenderNode, node: Node): RenderNode;
}
