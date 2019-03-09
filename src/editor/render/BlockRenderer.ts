import Node from '../model/Node';
import Renderer from './Renderer';
import DocRenderNode from './DocRenderNode';
import BlockRenderNode from './BlockRenderNode';

export type Parent = DocRenderNode;

export default abstract class BlockRenderer extends Renderer {

  abstract render(parent: Parent, node: Node): BlockRenderNode;
}
