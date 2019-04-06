import Config from '../Config';
import InputManager from '../input/InputManager';
import EventObserver from './EventObserver';
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
import TreeSyncer from '../helpers/TreeSyncer';

class LayoutToViewTreeSyncer extends TreeSyncer<LayoutNode, ViewNode> {
  protected config: Config;
  protected lastVersion: number;
  protected idMap: Map<string, [LayoutNode, ViewNode]>;

  constructor(config: Config, lastVersion: number, idMap: Map<string, [LayoutNode, ViewNode]>) {
    super();
    this.config = config;
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
      const BlockViewNodeClass = this.config.getViewNodeClass(srcNode.getType());
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
      const InlineViewNodeClass = this.config.getViewNodeClass(srcNode.getType());
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

export type OnMountedSubscriber = () => void;

export default class Presenter {
  protected config: Config;
  protected docBox: DocBox;
  protected inputManager: InputManager;
  protected eventObserver?: EventObserver;
  protected docViewNode: DocViewNode;
  protected onMountedSubscribers: OnMountedSubscriber[];
  protected mounted: boolean;
  protected version: number;
  protected domWrapper?: HTMLElement;
  protected idMap: Map<string, [LayoutNode, ViewNode]>;

  constructor(config: Config, docBox: DocBox, inputManager: InputManager) {
    this.config = config;
    this.docBox = docBox;
    this.inputManager = inputManager;
    this.docViewNode = new DocViewNode(docBox.getID());
    this.onMountedSubscribers = [];
    this.mounted = false;
    this.version = -1;
    this.idMap = new Map();
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
    domWrapper.appendChild(this.docViewNode.getDOMContainer());
    this.mounted = true;
    this.eventObserver = new EventObserver(this, this.inputManager);
    this.onMountedSubscribers.forEach(subscriber => subscriber());
  }

  protected run() {
    const treeSyncer = new LayoutToViewTreeSyncer(this.config, this.version, this.idMap);
    treeSyncer.syncNodes(this.docBox, this.docViewNode);
    this.version = this.docBox.getVersion();
    this.docViewNode.onUpdated();
  }

  getDocViewNode(): DocViewNode {
    return this.docViewNode;
  }

  subscribeOnMounted(subscriber: OnMountedSubscriber) {
    this.onMountedSubscribers.push(subscriber);
  }

  getPageDOMContentContainer(pageOffset: number): HTMLDivElement {
    const pages = this.docViewNode.getChildren();
    if (pageOffset < 0 || pageOffset >= pages.length) {
      throw new Error(`Page offset ${pageOffset} is out of range.`);
    }
    return pages[pageOffset].getDOMContentContainer();
  }

  resolveScreenPosition(x: number, y: number): number {
    const pageViews = this.docViewNode.getChildren();
    const pageFlowBoxes = this.docBox.getChildren();
    let cumulatedOffset = 0;
    for (let n = 0, nn = pageViews.length; n < nn; n++) {
      const pageView = pageViews[n];
      const pageFlowBox = pageFlowBoxes[n];
      const pageDOMContainer = pageView.getDOMContainer();
      const pageBoundingClientRect = pageDOMContainer.getBoundingClientRect();
      if (
        pageBoundingClientRect.left <= x &&
        pageBoundingClientRect.right >= x &&
        pageBoundingClientRect.top <= y &&
        pageBoundingClientRect.bottom >= y
      ) {
        const relativeX = x - pageBoundingClientRect.left;
        const relativeY = y - pageBoundingClientRect.top;
        return cumulatedOffset + pageFlowBox.resolveViewportPositionToSelectableOffset(relativeX, relativeY);
      }
      cumulatedOffset += pageFlowBox.getSelectableSize();
    }
    return -1;
  }

  resolveSelectionPosition(node: Node, offset: number): number {
    let currentElement: HTMLElement | null = node instanceof HTMLElement ? node : node.parentElement;
    while (currentElement) {
      const nodeID = currentElement.getAttribute('data-tw-id');
      if (nodeID) {
        const idMapValue = this.idMap.get(nodeID);
        if (!idMapValue) {
          return -1;
        }
        const [layoutNode, viewNode] = idMapValue;
        if (!(layoutNode instanceof InlineBox && viewNode instanceof InlineViewNode)) {
          return -1;
        }
        let resolvedOffset = viewNode.resolveSelectionOffset(offset);
        let currentLayoutNode: LayoutNode = layoutNode;
        while (currentLayoutNode) {
          if (currentLayoutNode instanceof InlineBox) {
            const siblings = currentLayoutNode.getParent().getChildren();
            let currentLayoutNodeOffset = siblings.indexOf(currentLayoutNode);
            while (currentLayoutNodeOffset > 0) {
              currentLayoutNodeOffset--;
              resolvedOffset += siblings[currentLayoutNodeOffset].getSelectableSize();
            }
            currentLayoutNode = currentLayoutNode.getParent();
          } else if (currentLayoutNode instanceof LineFlowBox) {
            if (currentLayoutNode.getSelectableSize() === resolvedOffset) {
              resolvedOffset--;
            }
            const siblings = currentLayoutNode.getParent().getChildren();
            let currentLayoutNodeOffset = siblings.indexOf(currentLayoutNode);
            while (currentLayoutNodeOffset > 0) {
              currentLayoutNodeOffset--;
              resolvedOffset += siblings[currentLayoutNodeOffset].getSelectableSize();
            }
            currentLayoutNode = currentLayoutNode.getParent();
          } else if (currentLayoutNode instanceof BlockBox) {
            const siblings = currentLayoutNode.getParent().getChildren();
            let currentLayoutNodeOffset = siblings.indexOf(currentLayoutNode);
            while (currentLayoutNodeOffset > 0) {
              currentLayoutNodeOffset--;
              resolvedOffset += siblings[currentLayoutNodeOffset].getSelectableSize();
            }
            currentLayoutNode = currentLayoutNode.getParent();
          } else if (currentLayoutNode instanceof PageFlowBox) {
            const siblings = currentLayoutNode.getParent().getChildren();
            let currentLayoutNodeOffset = siblings.indexOf(currentLayoutNode);
            while (currentLayoutNodeOffset > 0) {
              currentLayoutNodeOffset--;
              resolvedOffset += siblings[currentLayoutNodeOffset].getSelectableSize();
            }
            currentLayoutNode = currentLayoutNode.getParent();
          } else {
            break;
          }
        }
        return resolvedOffset;
      }
      currentElement = currentElement.parentElement;
    }
    return -1;
  }
}
