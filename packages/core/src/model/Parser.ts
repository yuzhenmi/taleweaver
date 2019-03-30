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

abstract class StackElementOperation {
  
  abstract shiftOffset(delta: number): void;
}

class StackElementInsertChildOperation extends StackElementOperation {
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

class StackElement {
  protected node: Node;
  protected children: Node[];
  protected invertedChildrenMap: Map<string, number>;
  protected childIteratorOffset: number;
  protected operationsBuffer: StackElementOperation[];
  protected operationsBufferFlushed: boolean;

  constructor(node: Node) {
    this.node = node;
    this.invertedChildrenMap = new Map();
    if (node instanceof Doc || node instanceof BranchNode) {
      this.children = node.getChildren();
      let child: Node;
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

  insertChild(child: Node) {
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

  flushOperationsBuffer(): boolean {
    let updated : boolean;
    if (this.operationsBuffer.length > 0) {
      const node = this.node;
      if (!(node instanceof Doc || node instanceof BranchNode)) {
        throw new Error(`Cannot flush operations for node ${node.getID()}, node has no children.`);
      }
      let operation: StackElementOperation;
      for (let n = 0, nn = this.operationsBuffer.length; n < nn; n++) {
        let delta: number;
        operation = this.operationsBuffer[n];
        if (operation instanceof StackElementInsertChildOperation) {
          // @ts-ignore
          node.insertChild(operation.getChild(), operation.getOffset());
          delta = 1;
        } else if (operation instanceof StackElementDeleteChildrenOperation) {
          const childrenToDelete = node.getChildren().slice(operation.getFromOffset(), operation.getToOffset() + 1);
          for (let m = 0, mm = childrenToDelete.length; m < mm; m++) {
            // @ts-ignore
            node.deleteChild(childrenToDelete[m]);
          }
          delta = 0 - childrenToDelete.length;
        } else {
          throw new Error('Unknown operation.');
        }
        if (delta !== 0) {
          for (let m = n; m < nn; m++) {
            this.operationsBuffer[m].shiftOffset(delta);
          }
        }
      }
      updated = true;
    } else {
      updated = false;
    }
    this.operationsBufferFlushed = true;
    return updated;
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

class Parser {
  protected config: Config;
  protected state: State;
  protected parserState: ParserState;
  protected doc: Doc;
  protected stack: Stack;
  protected contentBuffer: string;
  protected ran: boolean;
  protected version: number;

  constructor(config: Config, state: State) {
    this.config = config;
    this.state = state;
    this.parserState = ParserState.NewDoc;
    this.doc = new Doc();
    this.stack = new Stack;
    this.contentBuffer = '';
    this.ran = false;
    this.version = 0;
    this.state.subscribeOnUpdated(() => {
      this.parserState = ParserState.NewDoc;
      this.run();
    });
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
    this.version++;
    this.doc.onUpdated();
  }

  protected newDoc(token: OpenTagToken) {
    const doc = this.doc;
    const attributes = token.getAttributes();
    doc.setID(attributes.id);
    this.stack.push(new StackElement(doc));
    this.parserState = ParserState.NewNode;
  }

  protected newNode(token: OpenTagToken) {
    const lastStackElement = this.stack.peek();
    if (lastStackElement === undefined) {
      throw new Error('Unexpected end of doc encountered.');
    }
    const offset = lastStackElement.findChild(token.getAttributes().id);
    let node: Node;
    if (offset < 0) {
      const NodeClass = this.config.getNodeClass(token.getType());
      node = new NodeClass(lastStackElement.getNode());
      node.setVersion(this.version);
      lastStackElement.insertChild(node);
    } else {
      node = lastStackElement.getChildAt(offset);
      lastStackElement.deleteChildrenTo(offset);
    }
    const attributes = token.getAttributes();
    node.setID(attributes.id);
    this.stack.push(new StackElement(node));
  }

  protected appendToContent(token: string) {
    this.contentBuffer += token;
    this.parserState = ParserState.LeafNode;
  }

  protected closeNode(token: CloseTagToken) {
    const lastStackElement = this.stack.pop();
    if (lastStackElement === undefined) {
      throw new Error('Unexpected end of doc encountered.');
    }
    const updated = lastStackElement.flushOperationsBuffer();
    const node = lastStackElement.getNode();
    if (node instanceof LeafNode) {
      if (node.getContent() !== this.contentBuffer) {
        node.setContent(this.contentBuffer);
        node.setVersion(this.version);
      }
    }
    if (updated) {
      node.setVersion(this.version);
    }
    this.propagateVersionToAncestors(node);
    this.contentBuffer = '';
    this.parserState = ParserState.NewNode;
  }

  protected propagateVersionToAncestors(node: Node) {
    let currentNode = node;
    let parentNode: Node;
    while (currentNode instanceof BranchNode || currentNode instanceof LeafNode) {
      parentNode = currentNode.getParent();
      if (parentNode.getVersion() >= currentNode.getVersion()) {
        break;
      }
      parentNode.setVersion(currentNode.getVersion());
      currentNode = parentNode;
    }
  }
}

export default Parser;
