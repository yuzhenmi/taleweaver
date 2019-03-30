import Config from '../Config';
import TreeSyncer from '../helpers/TreeSyncer';
import Node from '../model/Node';
import Doc from '../model/Doc';
import BranchNode from '../model/BranchNode';
import LeafNode from '../model/LeafNode';
import RenderNode from './RenderNode';
import DocRenderNode from './DocRenderNode';
import BlockRenderNode from './BlockRenderNode';
import InlineRenderNode from './InlineRenderNode';

class ModelToRenderTreeSyncer extends TreeSyncer<Node, RenderNode> {
  protected config: Config;
  protected lastVersion: number;

  constructor(config: Config, lastVersion: number) {
    super();
    this.config = config;
    this.lastVersion = lastVersion;
  }

  getSrcNodeChildren(node: Node): Node[] {
    if (node instanceof Doc) {
      return node.getChildren();
    }
    if (node instanceof BranchNode) {
      return node.getChildren();
    }
    return [];
  }

  getDstNodeChildren(node: RenderNode): RenderNode[] {
    if (node instanceof DocRenderNode) {
      return [...node.getChildren()];
    }
    if (node instanceof BlockRenderNode) {
      return [...node.getChildren()];
    }
    return [];
  }

  findSrcNodeInDstNodes(srcNode: Node, dstNodes: RenderNode[]): number {
    const id = srcNode.getID();
    const offset = dstNodes.findIndex(n => n.getID() === id);
    return offset;
  }

  insertNode(parent: RenderNode, srcNode: Node, offset: number): RenderNode {
    if (parent instanceof DocRenderNode && srcNode instanceof BranchNode) {
      const BlockRenderNodeClass = this.config.getRenderNodeClass(srcNode.getType());
      const blockRenderNode = new BlockRenderNodeClass(srcNode.getID(), parent);
      if (!(blockRenderNode instanceof BlockRenderNode)) {
        throw new Error('Error inserting render node, expecting block render node.');
      }
      blockRenderNode.setVersion(srcNode.getVersion());
      parent.insertChild(blockRenderNode, offset);
      return blockRenderNode;
    }
    if (parent instanceof BlockRenderNode && srcNode instanceof LeafNode) {
      const InlineRenderNodeClass = this.config.getRenderNodeClass(srcNode.getType());
      const inlineRenderNode = new InlineRenderNodeClass(srcNode.getID(), parent);
      if (!(inlineRenderNode instanceof InlineRenderNode)) {
        throw new Error('Error inserting render node, expecting inline render node.');
      }
      inlineRenderNode.setVersion(srcNode.getVersion());
      parent.insertChild(inlineRenderNode, offset);
      return inlineRenderNode;
    }
    throw new Error('Error inserting render node, type mismatch.');
  }

  deleteNode(parent: RenderNode, node: RenderNode) {
    if (parent instanceof DocRenderNode && node instanceof BlockRenderNode) {
      parent.deleteChild(node);
      return;
    }
    if (parent instanceof BlockRenderNode && node instanceof InlineRenderNode) {
      parent.deleteChild(node);
      return;
    }
    throw new Error('Error deleting render node, type mismatch.');
  }

  updateNode(node: RenderNode, srcNode: Node): boolean {
    if (node instanceof DocRenderNode && srcNode instanceof Doc) {
      if (srcNode.getVersion() <= this.lastVersion) {
        return false;
      }
      node.onModelUpdated(srcNode);
      node.setVersion(srcNode.getVersion());
      return true;
    }
    if (node instanceof BlockRenderNode && srcNode instanceof BranchNode) {
      if (srcNode.getVersion() <= this.lastVersion) {
        return false;
      }
      node.onModelUpdated(srcNode);
      node.setVersion(srcNode.getVersion());
      return true;
    }
    if (node instanceof InlineRenderNode && srcNode instanceof LeafNode) {
      if (srcNode.getVersion() <= this.lastVersion) {
        return false;
      }
      node.onModelUpdated(srcNode);
      node.setVersion(srcNode.getVersion());
      return true;
    }
    throw new Error('Error updating render node, type mismatch.');
  }
}

export default class RenderEngine {
  protected config: Config;
  protected doc: Doc;
  protected docRenderNode: DocRenderNode;
  protected ran: boolean;
  protected version: number;

  constructor(config: Config, doc: Doc) {
    this.config = config;
    this.doc = doc;
    this.docRenderNode = new DocRenderNode(doc.getID());
    this.ran = false;
    this.version = -1;
    this.doc.subscribeOnUpdated(() => {
      this.run();
    });
  }

  getDocRenderNode(): DocRenderNode {
    if (!this.ran) {
      this.run();
    }
    return this.docRenderNode;
  }

  protected run() {
    const treeSyncer = new ModelToRenderTreeSyncer(this.config, this.version);
    treeSyncer.syncNodes(this.doc, this.docRenderNode);
    this.ran = true;
    this.version = this.doc.getVersion();
    this.docRenderNode.onUpdated();
  }

  protected getNextVersion(): number {
    return this.docRenderNode.getVersion() + 1;
  }
}
