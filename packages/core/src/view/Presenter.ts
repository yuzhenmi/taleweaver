import { LayoutStateUpdatedEvent, ViewStateUpdatedEvent } from '../dispatch/events';
import Editor from '../Editor';
import BlockBox from '../layout/BlockLayoutNode';
import DocBox from '../layout/DocLayoutNode';
import InlineBox from '../layout/InlineLayoutNode';
import LayoutNode from '../layout/LayoutNode';
import LineFlowBox from '../layout/LineLayoutNode';
import PageFlowBox from '../layout/PageLayoutNode';
import TreeSyncer from '../utils/TreeSyncer';
import bindKeys from './bindKeys';
import BlockViewNode from './BlockViewNode';
import DocViewNode from './DocViewNode';
import InlineViewNode from './InlineViewNode';
import LineViewNode from './LineViewNode';
import PageViewNode from './PageViewNode';
import ViewNode from './ViewNode';

class LayoutToViewTreeSyncer extends TreeSyncer<LayoutNode, ViewNode> {
  protected editor: Editor;
  protected idMap: Map<string, [LayoutNode, ViewNode]>;

  constructor(editor: Editor, idMap: Map<string, [LayoutNode, ViewNode]>) {
    super();
    this.editor = editor;
    this.idMap = idMap;
  }

  getSrcNodeChildren(node: LayoutNode): LayoutNode[] {
    if (node instanceof DocBox) {
      return node.getChildren();
    }
    if (node instanceof PageFlowBox) {
      return node.getChildren();
    }
    if (node instanceof BlockBox) {
      return node.getChildren();
    }
    if (node instanceof LineFlowBox) {
      return node.getChildren();
    }
    return [];
  }

  getDstNodeChildren(node: ViewNode): ViewNode[] {
    if (node instanceof DocViewNode) {
      return [...node.getChildren()];
    }
    if (node instanceof PageViewNode) {
      return [...node.getChildren()];
    }
    if (node instanceof BlockViewNode) {
      return [...node.getChildren()];
    }
    if (node instanceof LineViewNode) {
      return [...node.getChildren()];
    }
    return [];
  }

  findSrcNodeInDstNodes(srcNode: LayoutNode, dstNodes: ViewNode[]): number {
    const id = srcNode.getID();
    const offset = dstNodes.findIndex(n => n.getID() === id);
    return offset;
  }

  insertNode(parent: ViewNode, srcNode: LayoutNode, offset: number): ViewNode {
    const elementConfig = this.editor.getConfig().getElementConfig();
    if (parent instanceof DocViewNode && srcNode instanceof PageFlowBox) {
      const pageViewNode = new PageViewNode(this.editor, srcNode.getID());
      parent.insertChild(pageViewNode, offset);
      this.idMap.set(srcNode.getID(), [srcNode, pageViewNode]);
      return pageViewNode;
    }
    if (parent instanceof PageViewNode && srcNode instanceof BlockBox) {
      const BlockViewNodeClass = elementConfig.getBlockViewNodeClass(srcNode.getType());
      const blockViewNode = new BlockViewNodeClass(this.editor, srcNode.getID());
      if (!(blockViewNode instanceof BlockViewNode)) {
        throw new Error('Error inserting view node, expected block view to be built from block box.');
      }
      parent.insertChild(blockViewNode, offset);
      this.idMap.set(srcNode.getID(), [srcNode, blockViewNode]);
      return blockViewNode;
    }
    if (parent instanceof BlockViewNode && srcNode instanceof LineFlowBox) {
      const lineViewNode = new LineViewNode(this.editor, srcNode.getID());
      parent.insertChild(lineViewNode, offset);
      this.idMap.set(srcNode.getID(), [srcNode, lineViewNode]);
      return lineViewNode;
    }
    if (parent instanceof LineViewNode && srcNode instanceof InlineBox) {
      const InlineViewNodeClass = elementConfig.getInlineViewNodeClass(srcNode.getType());
      const inlineViewNode = new InlineViewNodeClass(this.editor, srcNode.getID());
      if (!(inlineViewNode instanceof InlineViewNode)) {
        throw new Error('Error inserting view node, expected inline view to be built from inline box.');
      }
      parent.insertChild(inlineViewNode, offset);
      this.idMap.set(srcNode.getID(), [srcNode, inlineViewNode]);
      return inlineViewNode;
    }
    throw new Error('Error inserting view node, type mismatch.');
  }

  deleteNode(parent: ViewNode, node: ViewNode) {
    if (parent instanceof DocViewNode && node instanceof PageViewNode) {
      parent.deleteChild(node);
      this.idMap.delete(node.getID());
      return;
    }
    if (parent instanceof PageViewNode && node instanceof BlockViewNode) {
      parent.deleteChild(node);
      this.idMap.delete(node.getID());
      return;
    }
    if (parent instanceof BlockViewNode && node instanceof LineViewNode) {
      parent.deleteChild(node);
      this.idMap.delete(node.getID());
      return;
    }
    if (parent instanceof LineViewNode && node instanceof InlineViewNode) {
      parent.deleteChild(node);
      this.idMap.delete(node.getID());
      return;
    }
    throw new Error('Error deleting view node, type mismatch.');
  }

  updateNode(node: ViewNode, srcNode: LayoutNode): boolean {
    if (srcNode.getVersion() <= node.getVersion()) {
      return false;
    }
    if (node instanceof DocViewNode && srcNode instanceof DocBox) {
      node.onLayoutUpdated(srcNode);
      return true;
    }
    if (node instanceof PageViewNode && srcNode instanceof PageFlowBox) {
      node.onLayoutUpdated(srcNode);
      return true;
    }
    if (node instanceof BlockViewNode && srcNode instanceof BlockBox) {
      node.onLayoutUpdated(srcNode);
      return true;
    }
    if (node instanceof LineViewNode && srcNode instanceof LineFlowBox) {
      node.onLayoutUpdated(srcNode);
      return true;
    }
    if (node instanceof InlineViewNode && srcNode instanceof InlineBox) {
      node.onLayoutUpdated(srcNode);
      return true;
    }
    throw new Error('Error updating view node, type mismatch.');
  }
}

class Presenter {
  protected editor: Editor;
  protected docViewNode: DocViewNode;
  protected domWrapper: HTMLElement;
  protected idMap: Map<string, [LayoutNode, ViewNode]>;

  constructor(editor: Editor, docViewNode: DocViewNode, domWrapper: HTMLElement) {
    this.editor = editor;
    this.docViewNode = docViewNode;
    this.domWrapper = domWrapper;
    domWrapper.appendChild(this.docViewNode.getDOMContainer());
    this.idMap = new Map();
    bindKeys(editor);
    editor.getDispatcher().on(LayoutStateUpdatedEvent, event => this.sync());
    this.sync();
  }

  getPageDOMContentContainer(pageOffset: number) {
    const pages = this.docViewNode.getChildren();
    if (pageOffset < 0 || pageOffset >= pages.length) {
      throw new Error(`Page offset ${pageOffset} is out of range.`);
    }
    return pages[pageOffset].getDOMContentContainer();
  }

  protected sync() {
    const docBox = this.editor.getLayoutManager().getDocBox();
    const treeSyncer = new LayoutToViewTreeSyncer(this.editor, this.idMap);
    treeSyncer.syncNodes(docBox, this.docViewNode);
    const updatedViewNodes = treeSyncer.getUpdatedNodes();
    updatedViewNodes.forEach(viewNode => {
      viewNode.bumpVersion();
      if (viewNode instanceof PageViewNode || viewNode instanceof BlockViewNode || viewNode instanceof LineViewNode) {
        updatedViewNodes.add(viewNode.getParent());
      }
    });
    this.editor.getDispatcher().dispatch(new ViewStateUpdatedEvent());
  }
}

export default Presenter;
