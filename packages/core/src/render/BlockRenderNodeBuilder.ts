import Node from '../model/Node';
import RenderNodeBuilder from './RenderNodeBuilder';
import DocRenderNode from './DocRenderNode';
import BlockRenderNode from './BlockRenderNode';

export type Parent = DocRenderNode;

export default abstract class BlockRenderNodeBuilder extends RenderNodeBuilder {

  abstract render(parent: Parent, node: Node): BlockRenderNode;
}
