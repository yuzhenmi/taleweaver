import Editor from '../Editor';
import { LayoutStateUpdatedEvent, ViewStateUpdatedEvent } from '../dispatch/events';
import LayoutNode from '../layout/LayoutNode';
import DocBox from '../layout/DocBox';
import PageFlowBox from '../layout/PageFlowBox';
import BlockBox from '../layout/BlockBox';
import LineFlowBox from '../layout/LineFlowBox';
import InlineBox from '../layout/InlineBox';
import ViewNode from './ViewNode';
import DocViewNode from './DocViewNode';
import BlockViewNode from './BlockViewNode';
import PageViewNode from './PageViewNode';
import LineViewNode from './LineViewNode';
import InlineViewNode from './InlineViewNode';
import TreeSyncer from '../utils/TreeSyncer';
import bindKeys from './bindKeys';

class LayoutToViewTreeSyncer extends TreeSyncer<LayoutNode, ViewNode> {
  protected editor: Editor;
  protected lastVersion: number;
  protected idMap: Map<string, [LayoutNode, ViewNode]>;

  constructor(editor: Editor, lastVersion: number, idMap: Map<string, [LayoutNode, ViewNode]>) {
    super();
    this.editor = editor;
    this.lastVersion = lastVersion;
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
    if (parent instanceof DocViewNode && srcNode instanceof PageFlowBox) {
      const pageViewNode = new PageViewNode(srcNode.getID());
      parent.insertChild(pageViewNode, offset);
      this.idMap.set(srcNode.getID(), [srcNode, pageViewNode]);
      return pageViewNode;
    }
    if (parent instanceof PageViewNode && srcNode instanceof BlockBox) {
      const BlockViewNodeClass = this.editor.getConfig().getViewNodeClass(srcNode.getType());
      const blockViewNode = new BlockViewNodeClass(srcNode.getID());
      if (!(blockViewNode instanceof BlockViewNode)) {
        throw new Error('Error inserting view node, expected block view to be built from block box.');
      }
      parent.insertChild(blockViewNode, offset);
      this.idMap.set(srcNode.getID(), [srcNode, blockViewNode]);
      return blockViewNode;
    }
    if (parent instanceof BlockViewNode && srcNode instanceof LineFlowBox) {
      const lineViewNode = new LineViewNode(srcNode.getID());
      parent.insertChild(lineViewNode, offset);
      this.idMap.set(srcNode.getID(), [srcNode, lineViewNode]);
      return lineViewNode;
    }
    if (parent instanceof LineViewNode && srcNode instanceof InlineBox) {
      const InlineViewNodeClass = this.editor.getConfig().getViewNodeClass(srcNode.getType());
      const inlineViewNode = new InlineViewNodeClass(srcNode.getID());
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
    if (node instanceof DocViewNode && srcNode instanceof DocBox) {
      if (srcNode.getVersion() <= this.lastVersion) {
        return false;
      }
      node.onLayoutUpdated(srcNode);
      return true;
    }
    if (node instanceof PageViewNode && srcNode instanceof PageFlowBox) {
      if (srcNode.getVersion() <= this.lastVersion) {
        return false;
      }
      node.onLayoutUpdated(srcNode);
      return true;
    }
    if (node instanceof BlockViewNode && srcNode instanceof BlockBox) {
      if (srcNode.getVersion() <= this.lastVersion) {
        return false;
      }
      node.onLayoutUpdated(srcNode);
      return true;
    }
    if (node instanceof LineViewNode && srcNode instanceof LineFlowBox) {
      if (srcNode.getVersion() <= this.lastVersion) {
        return false;
      }
      node.onLayoutUpdated(srcNode);
      return true;
    }
    if (node instanceof InlineViewNode && srcNode instanceof InlineBox) {
      if (srcNode.getVersion() <= this.lastVersion) {
        return false;
      }
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
  protected version: number;
  protected idMap: Map<string, [LayoutNode, ViewNode]>;

  constructor(editor: Editor, docViewNode: DocViewNode, domWrapper: HTMLElement) {
    this.editor = editor;
    this.docViewNode = docViewNode;
    this.domWrapper = domWrapper;
    domWrapper.appendChild(this.docViewNode.getDOMContainer());
    this.version = -1;
    this.idMap = new Map();
    bindKeys(editor);
    editor.getDispatcher().on(LayoutStateUpdatedEvent, event => this.sync());
    this.sync();
  }

  getPageDOMContentContainer(pageOffset: number): HTMLDivElement {
    const pages = this.docViewNode.getChildren();
    if (pageOffset < 0 || pageOffset >= pages.length) {
      throw new Error(`Page offset ${pageOffset} is out of range.`);
    }
    return pages[pageOffset].getDOMContentContainer();
  }

  protected sync() {
    const docBox = this.editor.getLayoutManager().getDocBox();
    const treeSyncer = new LayoutToViewTreeSyncer(this.editor, this.version, this.idMap);
    treeSyncer.syncNodes(docBox, this.docViewNode);
    this.version = docBox.getVersion();
    this.editor.getDispatcher().dispatch(new ViewStateUpdatedEvent());
  }
}

export default Presenter;
