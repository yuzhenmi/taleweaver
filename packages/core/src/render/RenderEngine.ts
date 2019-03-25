import Config from '../Config';
import Node from '../model/Node';
import Doc from '../model/Doc';
import BranchNode from '../model/BranchNode';
import RenderNode from './RenderNode';
import DocRenderNode from './DocRenderNode';
import BlockRenderNode from './BlockRenderNode';
import InlineRenderNode from './InlineRenderNode';

abstract class StackElementOperation {
  
  abstract shiftOffset(delta: number): void;
}

class StackElementInsertChildOperation extends StackElementOperation {
  protected offset: number;
  protected child: RenderNode;

  constructor(offset: number, child: RenderNode) {
    super();
    this.offset = offset;
    this.child = child;
  }

  shiftOffset(delta: number) {
    this.offset += delta;
  }

  getOffset(): number {
    return this.offset;
  }

  getChild(): RenderNode {
    return this.child;
  }
}

class StackElementDeleteChildrenOperation extends StackElementOperation {
  protected fromOffset: number;
  protected toOffset: number;

  constructor(fromOffset: number, toOffset: number) {
    super();
    this.fromOffset = fromOffset;
    this.toOffset = toOffset;
  }

  shiftOffset(delta: number) {
    this.fromOffset += delta;
    this.toOffset += delta;
  }

  getFromOffset(): number {
    return this.fromOffset;
  }

  getToOffset(): number {
    return this.toOffset;
  }
}

class StackElementReplaceChildOperation extends StackElementOperation {
  protected offset: number;
  protected child: RenderNode;

  constructor(offset: number, child: RenderNode) {
    super();
    this.offset = offset;
    this.child = child;
  }

  shiftOffset(delta: number) {
    this.offset += delta;
  }

  getOffset(): number {
    return this.offset;
  }

  getChild(): RenderNode {
    return this.child;
  }
}

class StackElement {
  protected nodes: Node[];
  protected iteratorOffset: number;
  protected renderNode: RenderNode;
  protected children: RenderNode[];
  protected invertedChildrenMap: Map<string, number>;
  protected childIteratorOffset: number;
  protected operationsBuffer: StackElementOperation[];
  protected operationsBufferFlushed: boolean;

  constructor(nodes: Node[], renderNode: RenderNode) {
    this.nodes = nodes;
    this.renderNode = renderNode;
    this.iteratorOffset = -1;
    this.invertedChildrenMap = new Map();
    if (renderNode instanceof DocRenderNode || renderNode instanceof BlockRenderNode) {
      this.children = renderNode.getChildren();
      let child: RenderNode;
      for (let n = 0, nn = this.children.length; n < nn; n++) {
        child = this.children[n];
        this.invertedChildrenMap.set(child.getID(), n);
      }
    } else {
      this.children = [];
    }
    this.childIteratorOffset = 0;
    this.operationsBuffer = [];
    this.operationsBufferFlushed = false;
  }

  iterate(): Node | undefined {
    this.iteratorOffset += 1;
    if (this.iteratorOffset < this.nodes.length) {
      return this.nodes[this.iteratorOffset];
    }
    return undefined;
  }

  getRenderNode(): RenderNode {
    return this.renderNode;
  }

  findChild(childID: string): number {
    const offset = this.invertedChildrenMap.get(childID);
    if (offset === undefined) {
      return -1;
    }
    return offset;
  }

  getChildAt(offset: number): RenderNode {
    if (offset < this.childIteratorOffset) {
      throw new Error(`Cannot get child at offset ${offset}, child iterator offset is already at ${this.childIteratorOffset}.`);
    }
    if (offset < 0 || offset > this.children.length - 1) {
      throw new Error(`Child offset ${offset} is out of valid range 0-${this.children.length - 1}.`);
    }
    return this.children[offset];
  }

  insertChild(child: RenderNode) {
    if (this.operationsBufferFlushed) {
      throw new Error('Cannot append more operations after flushing.');
    }
    const operation = new StackElementInsertChildOperation(this.childIteratorOffset, child);
    this.operationsBuffer.push(operation);
  }

  deleteChildrenTo(offset: number) {
    if (this.operationsBufferFlushed) {
      throw new Error('Cannot append more child operations after flushing.');
    }
    if (offset < this.childIteratorOffset) {
      throw new Error(`Cannot delete children to offset ${offset}, iterator offset is already at ${this.childIteratorOffset}.`);
    }
    this.childIteratorOffset = offset;
    if (offset === this.childIteratorOffset) {
      return;
    }
    const operation = new StackElementDeleteChildrenOperation(this.childIteratorOffset, offset - 1);
    this.operationsBuffer.push(operation);
  }

  replaceChild(child: RenderNode) {
    if (this.operationsBufferFlushed) {
      throw new Error('Cannot append more child operations after flushing.');
    }
    const operation = new StackElementReplaceChildOperation(this.childIteratorOffset, child);
    this.operationsBuffer.push(operation);
  }

  flushOperationsBuffer() {
    if (this.operationsBuffer.length > 0) {
      const renderNode = this.renderNode;
      if (!(renderNode instanceof DocRenderNode || renderNode instanceof BlockRenderNode)) {
        throw new Error(`Cannot flush operations for render node ${renderNode.getID()}, render node has no children.`);
      }
      let operation: StackElementOperation;
      for (let n = 0, nn = this.operationsBuffer.length; n < nn; n++) {
        let delta: number;
        operation = this.operationsBuffer[n];
        if (operation instanceof StackElementInsertChildOperation) {
          // @ts-ignore
          renderNode.insertChild(operation.getChild(), operation.getOffset());
          delta = 1;
        } else if (operation instanceof StackElementDeleteChildrenOperation) {
          const childrenToDelete = renderNode.getChildren().slice(operation.getFromOffset(), operation.getToOffset() + 1);
          for (let m = 0, mm = childrenToDelete.length; m < mm; m++) {
            // @ts-ignore
            renderNode.deleteChild(childrenToDelete[m]);
          }
          delta = 0 - childrenToDelete.length;
        } else if (operation instanceof StackElementReplaceChildOperation) {
          const childToReplace = renderNode.getChildren()[operation.getOffset()];
          // @ts-ignore
          renderNode.deleteChild(childToReplace);
          // @ts-ignore
          renderNode.insertChild(operation.getChild(), operation.getOffset());
          delta = 0;
        } else {
          throw new Error('Unknown operation.');
        }
        if (delta !== 0) {
          for (let m = n; m < nn; m++) {
            this.operationsBuffer[m].shiftOffset(delta);
          }
        }
      }
    }
    this.operationsBufferFlushed = true;
  }
}

class Stack {
  protected elements: StackElement[];

  constructor() {
    this.elements = [];
  }

  push(element: StackElement) {
    this.elements.push(element);
  }

  pop(): StackElement | undefined {
    return this.elements.pop();
  }

  peek(): StackElement | undefined {
    return this.elements[this.elements.length - 1];
  }
}

export default class RenderEngine {
  protected config: Config;
  protected doc: Doc;
  protected docRenderNode: DocRenderNode;
  protected stack: Stack;
  protected ran: boolean;
  protected ranVersion: number;

  constructor(config: Config, doc: Doc) {
    this.config = config;
    this.doc = doc;
    this.docRenderNode = new DocRenderNode(doc.getID(), doc.getSelectableSize(), 816, 1056, 60);
    this.stack = new Stack();
    this.ran = false;
    this.ranVersion = -1;
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
    this.stack.push(new StackElement(this.doc.getChildren(), this.docRenderNode));
    while (this.iterate()) {}
    this.ranVersion = this.doc.getVersion();
    this.ran = true;
    this.docRenderNode.onUpdated();
  }

  protected iterate(): boolean {
    const lastStackElement = this.stack.peek();
    if (!lastStackElement) {
      return false;
    }
    const node = lastStackElement.iterate();
    if (!node) {
      this.closeNode();
      return this.iterate();
    }
    if (node.getVersion() <= this.ranVersion) {
      return this.iterate();
    }
    this.newNode(node);
    return true;
  }

  protected newNode(node: Node) {
    const lastStackElement = this.stack.peek();
    if (lastStackElement === undefined) {
      throw new Error('Unexpected end of render doc encountered.');
    }
    const offset = lastStackElement.findChild(node.getID());
    const renderNodeBuilder = this.config.getRenderNodeBuilder(node.getType());
    const renderNode = renderNodeBuilder.build(lastStackElement.getRenderNode(), node);
    renderNode.setVersion(this.getNextVersion());
    if (offset < 0) {
      lastStackElement.insertChild(renderNode);
    } else {
      lastStackElement.deleteChildrenTo(offset);
      const originalRenderNode = lastStackElement.getChildAt(offset);
      if (originalRenderNode instanceof DocRenderNode || originalRenderNode instanceof BlockRenderNode) {
        // @ts-ignore
        originalRenderNode.getChildren().forEach((child, childOffset) => {
          // @ts-ignore
          renderNode.insertChild(child, childOffset);
        });
      }
      lastStackElement.replaceChild(renderNode);
    }
    if (node instanceof BranchNode) {
      this.stack.push(new StackElement(node.getChildren(), renderNode));
    }
  }

  protected closeNode() {
    const lastStackElement = this.stack.pop();
    if (lastStackElement === undefined) {
      throw new Error('Unexpected end of render doc encountered.');
    }
    lastStackElement.flushOperationsBuffer();
    this.propagateVersionToAncestors(lastStackElement.getRenderNode());
  }

  protected getNextVersion(): number {
    return this.docRenderNode.getVersion() + 1;
  }

  protected propagateVersionToAncestors(renderNode: RenderNode) {
    let currentRenderNode = renderNode;
    let parentRenderNode: RenderNode;
    while (currentRenderNode instanceof BlockRenderNode || currentRenderNode instanceof InlineRenderNode) {
      parentRenderNode = currentRenderNode.getParent();
      if (parentRenderNode.getVersion() >= currentRenderNode.getVersion()) {
        break;
      }
      parentRenderNode.setVersion(currentRenderNode.getVersion());
      currentRenderNode = parentRenderNode;
    }
  }
}
