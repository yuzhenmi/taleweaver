import Node from '../model/Node';
import RenderNodeBuilder from './RenderNodeBuilder';
import BlockRenderNode from './BlockRenderNode';
import InlineRenderNode from './InlineRenderNode';

export type Parent = BlockRenderNode;

export default abstract class InlineRenderNodeBuilder extends RenderNodeBuilder {

  abstract build(parent: Parent, node: Node): InlineRenderNode;
}
