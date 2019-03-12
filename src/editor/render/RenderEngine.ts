import Config from '../Config';
import RenderNode from './RenderNode';
import DocRenderNode from './DocRenderNode';
import Node from '../model/Node';
import Doc from '../model/Doc';
import BranchNode from '../model/BranchNode';
import BlockRenderNode from './BlockRenderNode';
import InlineRenderNode from './InlineRenderNode';
import BlockRenderer from './BlockRenderer';
import InlineRenderer from './InlineRenderer';

export default class RenderEngine {
  protected config: Config;
  protected renderDoc: DocRenderNode;

  constructor(config: Config, doc: Doc) {
    this.config = config;
    this.renderDoc = new DocRenderNode(doc.getSelectableSize());
    // TODO: Subscribe to changes from doc
    this.render(doc);
  }

  getDocRenderNode(): DocRenderNode {
    return this.renderDoc;
  }

  protected render(doc: Doc) {
    this.buildRenderNodeChildren(doc, this.renderDoc);
  }

  protected buildRenderNodeChildren(node: Node, renderNode: RenderNode) {
    if (renderNode instanceof DocRenderNode) {
      return this.buildDocRenderNodeChildren(node, renderNode);
    }
    if (renderNode instanceof BlockRenderNode) {
      return this.buildBlockRenderNodeChildren(node, renderNode);
    }
  }

  protected buildDocRenderNodeChildren(node: Node, renderNode: DocRenderNode) {
    if (!(node instanceof Doc)) {
      throw new Error(`Error building children for DocRenderNode, expecting Doc as input.`);
    }
    let offset = 0;
    node.getChildren().forEach(child => {
      const childRenderNode = this.buildRenderNode(renderNode, child);
      if (!(childRenderNode instanceof BlockRenderNode)) {
        throw new Error(`Error building children for DocRenderNode, expecting child to be BlockRenderNode. `);
      }
      renderNode.insertChild(childRenderNode, offset);
      offset += 1;
    });
  }

  protected buildBlockRenderNodeChildren(node: Node, renderNode: BlockRenderNode) {
    if (!(node instanceof BranchNode)) {
      throw new Error(`Error building children for DocRenderNode, expecting BranchNode as input.`);
    }
    let offset = 0;
    node.getChildren().forEach(child => {
      const childRenderNode = this.buildRenderNode(renderNode, child);
      if (!(childRenderNode instanceof InlineRenderNode)) {
        throw new Error(`Error building children for BlockRenderNode, expecting child to be InlineRenderNode. `);
      }
      renderNode.insertChild(childRenderNode, offset);
      offset += 1;
    });
  }

  protected buildRenderNode(parent: RenderNode, node: Node): RenderNode {
    const renderer = this.config.getRenderer(node.getType());
    if (renderer instanceof BlockRenderer) {
      return this.buildBlockRenderNode(parent, node, renderer);
    }
    if (renderer instanceof InlineRenderer) {
      return this.buildInlineRenderNode(parent, node, renderer);
    }
    throw new Error(`Error building node, renderer is not recognized.`);
  }

  protected buildBlockRenderNode(parent: RenderNode, node: Node, renderer: BlockRenderer): BlockRenderNode {
    if (!(parent instanceof DocRenderNode)) {
      throw new Error(`Error building block render node, expecting parent to be DocRenderNode.`);
    }
    const blockRenderNode = renderer.render(parent, node);
    this.buildBlockRenderNodeChildren(node, blockRenderNode);
    return blockRenderNode;
  }

  protected buildInlineRenderNode(parent: RenderNode, node: Node, renderer: InlineRenderer): InlineRenderNode {
    if (!(parent instanceof BlockRenderNode)) {
      throw new Error(`Error building inline render node, expecting parent to be BlockRenderNode.`);
    }
    const inlineRenderNode = renderer.render(parent, node);
    return inlineRenderNode;
  }
}
