import Config from '../Config';
import InputManager from '../input/InputManager';
import EventObserver from './EventObserver';
import LayoutNode from '../layout/LayoutNode';
import DocBox from '../layout/DocBox';
import PageBox from '../layout/PageBox';
import BlockBox from '../layout/BlockBox';
import LineBox from '../layout/LineBox';
import InlineBox from '../layout/InlineBox';
import View from './View';
import DocView from './DocView';
import BlockView from './BlockView';
import PageView from './PageView';
import LineView from './LineView';
import InlineView from './InlineView';
import TreeSyncer from '../helpers/TreeSyncer';

class LayoutToViewTreeSyncer extends TreeSyncer<LayoutNode, View> {
  protected config: Config;
  protected lastVersion: number;

  constructor(config: Config, lastVersion: number) {
    super();
    this.config = config;
    this.lastVersion = lastVersion;
  }

  getSrcNodeChildren(node: LayoutNode): LayoutNode[] {
    if (node instanceof DocBox) {
      return node.getChildren();
    }
    if (node instanceof PageBox) {
      return node.getChildren();
    }
    if (node instanceof BlockBox) {
      return node.getChildren();
    }
    if (node instanceof LineBox) {
      return node.getChildren();
    }
    return [];
  }

  getDstNodeChildren(node: View): View[] {
    if (node instanceof DocView) {
      return node.getChildren();
    }
    if (node instanceof PageView) {
      return node.getChildren();
    }
    if (node instanceof BlockView) {
      return node.getChildren();
    }
    if (node instanceof LineView) {
      return node.getChildren();
    }
    return [];
  }

  findSrcNodeInDstNodes(srcNode: LayoutNode, dstNodes: View[]): number {
    const id = srcNode.getID();
    const offset = dstNodes.findIndex(n => n.getID() === id);
    return offset;
  }

  insertNode(srcNode: LayoutNode, parent: View, offset: number): View {
    if (srcNode instanceof PageBox && parent instanceof DocView) {
      const pageView = new PageView(srcNode.getID());
      parent.insertChild(pageView, offset);
      pageView.onRender(srcNode);
      return pageView;
    }
    if (srcNode instanceof BlockBox && parent instanceof PageView) {
      const BlockViewClass = this.config.getViewClass(srcNode.getType());
      const blockView = new BlockViewClass(srcNode.getID());
      if (!(blockView instanceof BlockView)) {
        throw new Error('Error inserting view node, expected block view to be built from block box.');
      }
      parent.insertChild(blockView, offset);
      blockView.onRender(srcNode);
      return blockView;
    }
    if (srcNode instanceof LineBox && parent instanceof BlockView) {
      const lineView = new LineView(srcNode.getID());
      parent.insertChild(lineView, offset);
      lineView.onRender(srcNode);
      return lineView;
    }
    if (srcNode instanceof InlineBox && parent instanceof LineView) {
      const InlineViewClass = this.config.getViewClass(srcNode.getType());
      const inlineView = new InlineViewClass(srcNode.getID());
      if (!(inlineView instanceof InlineView)) {
        throw new Error('Error inserting view node, expected inline view to be built from inline box.');
      }
      parent.insertChild(inlineView, offset);
      inlineView.onRender(srcNode);
      return inlineView;
    }
    throw new Error('Error inserting view node, type mismatch.');
  }

  deleteNode(parent: View, node: View) {
    if (parent instanceof DocView && node instanceof PageView) {
      parent.deleteChild(node);
      return;
    }
    if (parent instanceof PageView && node instanceof BlockView) {
      parent.deleteChild(node);
      return;
    }
    if (parent instanceof BlockView && node instanceof LineView) {
      parent.deleteChild(node);
      return;
    }
    if (parent instanceof LineView && node instanceof InlineView) {
      parent.deleteChild(node);
      return;
    }
    throw new Error('Error deleting view node, type mismatch.');
  }

  updateNode(node: View, srcNode: LayoutNode): boolean {
    if (node instanceof DocView && srcNode instanceof DocBox) {
      node.onRender(srcNode);
      return srcNode.getVersion() > this.lastVersion;
    }
    if (node instanceof PageView && srcNode instanceof PageBox) {
      node.onRender(srcNode);
      return srcNode.getVersion() > this.lastVersion;
    }
    if (node instanceof BlockView && srcNode instanceof BlockBox) {
      node.onRender(srcNode);
      return srcNode.getVersion() > this.lastVersion;
    }
    if (node instanceof LineView && srcNode instanceof LineBox) {
      node.onRender(srcNode);
      return srcNode.getVersion() > this.lastVersion;
    }
    if (node instanceof InlineView && srcNode instanceof InlineBox) {
      node.onRender(srcNode);
      return srcNode.getVersion() > this.lastVersion;
    }
    throw new Error('Error updating view node, type mismatch.');
  }
}

export type OnMountedSubscriber = () => void;

export default class Presenter {
  protected config: Config;
  protected docBox: DocBox;
  protected inputManager: InputManager;
  protected eventObserver?: EventObserver;
  protected docView: DocView;
  protected onMountedSubscribers: OnMountedSubscriber[];
  protected mounted: boolean;
  protected version: number;
  protected domWrapper?: HTMLElement;

  constructor(config: Config, docBox: DocBox, inputManager: InputManager) {
    this.config = config;
    this.docBox = docBox;
    this.inputManager = inputManager;
    this.docView = new DocView(docBox.getID());
    this.onMountedSubscribers = [];
    this.mounted = false;
    this.version = -1;
    this.docBox.subscribeOnUpdated(() => {
      this.run();
    });
  }

  mount(domWrapper: HTMLElement) {
    if (this.mounted) {
      return;
    }
    this.domWrapper = domWrapper;
    this.run();
    domWrapper.appendChild(this.docView.getDOMContainer());
    this.mounted = true;
    this.eventObserver = new EventObserver(this, this.inputManager);
    this.onMountedSubscribers.forEach(subscriber => subscriber());
  }

  protected run() {
    const treeSyncer = new LayoutToViewTreeSyncer(this.config, this.version);
    treeSyncer.syncNodes(this.docBox, this.docView);
    this.version = this.docBox.getVersion();
  }

  getDocView(): DocView {
    return this.docView;
  }

  subscribeOnMounted(subscriber: OnMountedSubscriber) {
    this.onMountedSubscribers.push(subscriber);
  }

  getPageDOMContentContainer(pageOffset: number): HTMLDivElement {
    const pages = this.docView.getChildren();
    if (pageOffset < 0 || pageOffset >= pages.length) {
      throw new Error(`Page offset ${pageOffset} is out of range.`);
    }
    return pages[pageOffset].getDOMContentContainer();
  }
}
