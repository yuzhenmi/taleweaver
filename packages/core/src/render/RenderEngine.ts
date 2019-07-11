import { ModelStateUpdatedEvent, RenderStateUpdatedEvent } from '../dispatch/events';
import Editor from '../Editor';
import BlockElement from '../model/BlockModelNode';
import Doc from '../model/DocModelNode';
import InlineElement from '../model/InlineModelNode';
import Element from '../model/ModelNode';
import TreeSyncer from '../utils/TreeSyncer';
import BlockRenderNode from './BlockRenderNode';
import DocRenderNode from './DocRenderNode';
import InlineRenderNode from './InlineRenderNode';
import RenderNode from './RenderNode';

class ModelToRenderTreeSyncer extends TreeSyncer<Element, RenderNode> {
  protected editor: Editor;

  constructor(editor: Editor) {
    super();
    this.editor = editor;
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
      const BlockRenderNodeClass = elementConfig.getBlockRenderNodeClass(srcNode.getType());
      const blockRenderNode = new BlockRenderNodeClass(this.editor, srcNode.getID());
      if (!(blockRenderNode instanceof BlockRenderNode)) {
        throw new Error('Error inserting render node, expecting block render node.');
      }
      parent.insertChild(blockRenderNode, offset);
      return blockRenderNode;
    }
    if (parent instanceof BlockRenderNode && srcNode instanceof InlineElement) {
      const InlineRenderNodeClass = elementConfig.getInlineRenderNodeClass(srcNode.getType());
      const inlineRenderNode = new InlineRenderNodeClass(this.editor, srcNode.getID());
      if (!(inlineRenderNode instanceof InlineRenderNode)) {
        throw new Error('Error inserting render node, expecting inline render node.');
      }
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
    if (srcNode.getVersion() <= node.getVersion()) {
      return false;
    }
    if (node instanceof DocRenderNode && srcNode instanceof Doc) {
      node.onModelUpdated(srcNode);
      return true;
    }
    if (node instanceof BlockRenderNode && srcNode instanceof BlockElement) {
      node.onModelUpdated(srcNode);
      return true;
    }
    if (node instanceof InlineRenderNode && srcNode instanceof InlineElement) {
      node.onModelUpdated(srcNode);
      return true;
    }
    throw new Error('Error updating render node, type mismatch.');
  }
}

export default class RenderEngine {
  protected editor: Editor;
  protected docRenderNode: DocRenderNode;

  constructor(editor: Editor, docRenderNode: DocRenderNode) {
    this.editor = editor;
    this.docRenderNode = docRenderNode;
    editor.getDispatcher().on(ModelStateUpdatedEvent, event => this.sync());
    this.sync();
  }

  protected sync() {
    const doc = this.editor.getModelManager().getDoc();
    const treeSyncer = new ModelToRenderTreeSyncer(this.editor);
    treeSyncer.syncNodes(doc, this.docRenderNode);
    const updatedRenderNodes = treeSyncer.getUpdatedNodes();
    updatedRenderNodes.forEach(renderNode => {
      renderNode.bumpVersion();
      if (renderNode instanceof BlockRenderNode || renderNode instanceof InlineRenderNode) {
        updatedRenderNodes.add(renderNode.getParent());
      }
    });
    this.editor.getDispatcher().dispatch(new RenderStateUpdatedEvent());
  }
}
