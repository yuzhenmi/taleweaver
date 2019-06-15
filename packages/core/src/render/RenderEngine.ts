import Editor from '../Editor';
import TreeSyncer from '../utils/TreeSyncer';
import { ModelStateUpdatedEvent, RenderStateUpdatedEvent } from '../dispatch/events';
import Element from '../model/Element';
import Doc from '../model/Doc';
import BlockElement from '../model/BlockElement';
import InlineElement from '../model/InlineElement';
import RenderNode from './RenderNode';
import DocRenderNode from './DocRenderNode';
import BlockRenderNode from './BlockRenderNode';
import InlineRenderNode from './InlineRenderNode';

class ModelToRenderTreeSyncer extends TreeSyncer<Element, RenderNode> {
  protected editor: Editor;
  protected lastVersion: number;

  constructor(editor: Editor, lastVersion: number) {
    super();
    this.editor = editor;
    this.lastVersion = lastVersion;
  }

  getSrcNodeChildren(node: Element) {
    if (node instanceof Doc) {
      return node.getChildren();
    }
    if (node instanceof BlockElement) {
      return node.getChildren();
    }
    return [];
  }

  getDstNodeChildren(node: RenderNode) {
    if (node instanceof DocRenderNode) {
      return [...node.getChildren()];
    }
    if (node instanceof BlockRenderNode) {
      return [...node.getChildren()];
    }
    return [];
  }

  findSrcNodeInDstNodes(srcNode: Element, dstNodes: RenderNode[]) {
    const id = srcNode.getID();
    const offset = dstNodes.findIndex(n => n.getID() === id);
    return offset;
  }

  insertNode(parent: RenderNode, srcNode: Element, offset: number) {
    const elementConfig = this.editor.getConfig().getElementConfig();
    if (parent instanceof DocRenderNode && srcNode instanceof BlockElement) {
      const BlockRenderNodeClass = elementConfig.getRenderNodeClass(srcNode.getType());
      const blockRenderNode = new BlockRenderNodeClass(srcNode.getID());
      if (!(blockRenderNode instanceof BlockRenderNode)) {
        throw new Error('Error inserting render node, expecting block render node.');
      }
      blockRenderNode.setVersion(srcNode.getVersion());
      parent.insertChild(blockRenderNode, offset);
      return blockRenderNode;
    }
    if (parent instanceof BlockRenderNode && srcNode instanceof InlineElement) {
      const InlineRenderNodeClass = elementConfig.getRenderNodeClass(srcNode.getType());
      const inlineRenderNode = new InlineRenderNodeClass(srcNode.getID());
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

  updateNode(node: RenderNode, srcNode: Element) {
    if (node instanceof DocRenderNode && srcNode instanceof Doc) {
      if (srcNode.getVersion() <= this.lastVersion) {
        return false;
      }
      node.onModelUpdated(srcNode);
      node.setVersion(srcNode.getVersion());
      return true;
    }
    if (node instanceof BlockRenderNode && srcNode instanceof BlockElement) {
      if (srcNode.getVersion() <= this.lastVersion) {
        return false;
      }
      node.onModelUpdated(srcNode);
      node.setVersion(srcNode.getVersion());
      return true;
    }
    if (node instanceof InlineRenderNode && srcNode instanceof InlineElement) {
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
  protected editor: Editor;
  protected docRenderNode: DocRenderNode;
  protected version: number;

  constructor(editor: Editor, docRenderNode: DocRenderNode) {
    this.editor = editor;
    this.docRenderNode = docRenderNode;
    this.version = -1;
    editor.getDispatcher().on(ModelStateUpdatedEvent, event => this.sync());
    this.sync();
  }

  protected sync() {
    const doc = this.editor.getModelManager().getDoc();
    const treeSyncer = new ModelToRenderTreeSyncer(this.editor, this.version);
    treeSyncer.syncNodes(doc, this.docRenderNode);
    this.version = doc.getVersion();
    this.editor.getDispatcher().dispatch(new RenderStateUpdatedEvent());
  }

  protected getNextVersion() {
    return this.docRenderNode.getVersion() + 1;
  }
}
