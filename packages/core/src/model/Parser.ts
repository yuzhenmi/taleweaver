import Config from '../Config';
import State from '../state/State';
import Token from '../state/Token';
import OpenTagToken from '../state/OpenTagToken';
import CloseTagToken from '../state/CloseTagToken';
import Node from './Node';
import Doc from './Doc';
import BranchNode from './BranchNode';
import LeafNode from './LeafNode';

enum ParserState {
  NewDoc,
  NewNode,
  LeafNode,
}

abstract class NodeStackElementChildOperation {
  
  abstract shiftOffset(delta: number): void;
}

class NodeStackElementInsertChildOperation extends NodeStackElementChildOperation {
  protected offset: number;
  protected child: Node;

  constructor(offset: number, child: Node) {
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

  getChild(): Node {
    return this.child;
  }
}

class NodeStackElementDeleteChildrenOperation extends NodeStackElementChildOperation {
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

class NodeStackElement {
  protected node: Node;
  protected children: Node[];
  protected invertedChildrenMap: Map<string, number>;
  protected childIteratorOffset: number;
  protected childOperationsBuffer: NodeStackElementChildOperation[];
  protected flushedChildOperations: boolean;

  constructor(node: Node) {
    this.node = node;
    this.invertedChildrenMap = new Map();
    if (node instanceof Doc || node instanceof BranchNode) {
      this.children = [];
      const children = node.getChildren();
      let child: Node;
      for (let n = 0, nn = children.length; n < nn; n++) {
        child = children[n];
        this.invertedChildrenMap.set(child.getID(), n);
      }
    } else {
      this.children = [];
    }
    this.childIteratorOffset = 0;
    this.childOperationsBuffer = [];
    this.flushedChildOperations = false;
  }

  getNode(): Node {
    return this.node;
  }

  findChild(childID: string): number {
    const offset = this.invertedChildrenMap.get(childID);
    if (offset === undefined) {
      return -1;
    }
    return offset;
  }

  getChildAt(offset: number): Node {
    if (offset < this.childIteratorOffset) {
      throw new Error(`Cannot get child at offset ${offset}, child iterator offset is already at ${this.childIteratorOffset}.`);
    }
    if (offset < 0 || offset > this.children.length - 1) {
      throw new Error(`Child offset ${offset} is out of valid range 0-${this.children.length - 1}.`);
    }
    return this.children[offset];
  }

  moveChildIterator(offset: number) {
    if (offset < this.childIteratorOffset) {
      throw new Error('Cannot move child iterator backwards.');
    }
    this.childIteratorOffset = offset;
  }

  deleteChildrenTo(toOffset: number) {
    if (this.flushedChildOperations) {
      throw new Error('Cannot append more child operations after flushing.');
    }
    if (toOffset === this.childIteratorOffset) {
      return;
    }
    if (toOffset < this.childIteratorOffset) {
      throw new Error(`Cannot delete children to offset ${toOffset}, iterator offset is already at ${this.childIteratorOffset}.`);
    }
    const childOperation = new NodeStackElementDeleteChildrenOperation(this.childIteratorOffset, toOffset - 1);
    this.childOperationsBuffer.push(childOperation);
  }

  insertChild(child: Node) {
    if (this.flushedChildOperations) {
      throw new Error('Cannot append more child operations after flushing.');
    }
    const childOperation = new NodeStackElementInsertChildOperation(this.childIteratorOffset, child);
    this.childOperationsBuffer.push(childOperation);
  }

  flushChildOperations() {
    if (this.childOperationsBuffer.length > 0) {
      const node = this.node;
      if (!(node instanceof Doc || node instanceof BranchNode)) {
        throw new Error(`Cannot flush child operations for node ${node.getID()}, node has no children.`);
      }
      let childOperation: NodeStackElementChildOperation;
      for (let n = 0, nn = this.childOperationsBuffer.length; n < nn; n++) {
        let delta: number;
        childOperation = this.childOperationsBuffer[n];
        if (childOperation instanceof NodeStackElementInsertChildOperation) {
          node.insertChild(childOperation.getChild() as BranchNode | LeafNode, childOperation.getOffset());
          delta = 1;
        } else if (childOperation instanceof NodeStackElementDeleteChildrenOperation) {
          const childrenToDelete = node.getChildren().slice(childOperation.getFromOffset(), childOperation.getToOffset() + 1);
          for (let m = 0, mm = childrenToDelete.length; m < mm; m++) {
            node.deleteChild(childrenToDelete[m]);
          }
          delta = 0 - childrenToDelete.length;
        } else {
          throw new Error('Child operation is not recognized.');
        }
        if (delta !== 0) {
          for (let m = n; m < nn; m++) {
            this.childOperationsBuffer[m].shiftOffset(delta);
          }
        }
      }
    }
    this.flushedChildOperations = true;
  }
}

class NodeStack {
  protected elements: NodeStackElement[];

  constructor() {
    this.elements = [];
  }

  push(element: NodeStackElement) {
    this.elements.push(element);
  }

  pop(): NodeStackElement | undefined {
    return this.elements.pop();
  }

  peek(): NodeStackElement | undefined {
    return this.elements[this.elements.length - 1];
  }
}

class Parser {
  protected config: Config;
  protected state: State;
  protected parserState: ParserState;
  protected doc: Doc;
  protected nodeStack: NodeStack;
  protected contentBuffer: string;
  protected ran: boolean;

  constructor(config: Config, state: State) {
    this.config = config;
    this.state = state;
    this.parserState = ParserState.NewDoc;
    this.doc = new Doc();
    this.nodeStack = new NodeStack;
    this.contentBuffer = '';
    this.ran = false;
  }

  getDoc(): Doc {
    if (!this.ran) {
      this.run();
    }
    return this.doc;
  }

  protected run() {
    const tokens = this.state.getTokens();
    let token: Token;
    for (let n = 0, nn = tokens.length; n < nn; n++) {
      token = tokens[n];
      switch (this.parserState) {
        case ParserState.NewDoc:
          if (token instanceof OpenTagToken && token.getType() === 'Doc') {
            this.newDoc(token);
            break;
          }
        case ParserState.NewNode:
          if (token instanceof OpenTagToken) {
            this.newNode(token);
            break;
          }
          if (typeof token === 'string') {
            this.appendToContent(token);
            break;
          }
          if (token instanceof CloseTagToken) {
            this.closeNode(token);
            break;
          }
          this.appendToContent(token);
          break;
        case ParserState.LeafNode:
          if (typeof token === 'string') {
            this.appendToContent(token);
            break;
          }
          if (token instanceof CloseTagToken) {
            this.closeNode(token);
            break;
          }
        default:
          throw new Error(`Unexpected token at offset ${n}.`);
      }
    }
    this.ran = true;
  }

  protected newDoc(token: OpenTagToken) {
    const doc = this.doc;
    // TODO: Update Doc attributes from token
    this.nodeStack.push(new NodeStackElement(doc));
    this.parserState = ParserState.NewNode;
  }

  protected newNode(token: OpenTagToken) {
    const lastNodeStackElement = this.nodeStack.peek();
    if (lastNodeStackElement === undefined) {
      throw new Error('Unexpected end of doc encountered.');
    }
    const offset = lastNodeStackElement.findChild(token.getAttributes().id);
    let node: Node;
    if (offset < 0) {
      const NodeClass = this.config.getNodeClass(token.getType());
      node = new NodeClass(lastNodeStackElement.getNode());
      lastNodeStackElement.insertChild(node);
    } else {
      node = lastNodeStackElement.getChildAt(offset);
    }
    // TODO: Update Node attributes from token
    this.nodeStack.push(new NodeStackElement(node));
  }

  protected appendToContent(token: string) {
    this.contentBuffer += token;
    this.parserState = ParserState.LeafNode;
  }

  protected closeNode(token: CloseTagToken) {
    const lastNodeStackElement = this.nodeStack.pop();
    if (lastNodeStackElement === undefined) {
      throw new Error('Unexpected end of doc encountered.');
    }
    lastNodeStackElement.flushChildOperations();
    const node = lastNodeStackElement.getNode();
    if (node instanceof LeafNode) {
      node.setContent(this.contentBuffer);
    }
    this.contentBuffer = '';
    this.parserState = ParserState.NewNode;
  }
}

export default Parser;
