import Config from '../Config';
import Token from '../state/Token';
import Node from './Node';
import RootNode from './RootNode';
import BranchNode from './BranchNode';
import LeafNode from './LeafNode';
import OpenTagToken from '../state/OpenTagToken';
import CloseTagToken from '../state/CloseTagToken';

enum State {
  ReadyForDocOpenTag,
  ReadyForTag,
  ReadingLeafNodeContent,
}

interface ChildInfo {
  child: Node;
  offset: number;
}

type ChildrenMap = Map<string, ChildInfo>;

interface NodeInfo {
  node: RootNode | BranchNode;
  childrenMap: ChildrenMap;
}

class NodeStack {
  private values: NodeInfo[];

  constructor() {
    this.values = [];
  }

  push(value: NodeInfo) {
    this.values.push(value);
  }

  pop(): NodeInfo {
    if (this.values.length === 0) {
      throw new Error('Nothing to pop, stack is empty.');
    }
    return this.values.pop()!;
  }

  get(): NodeInfo {
    return this.values[this.values.length - 1];
  }
}

function buildChildrenMap(children: (BranchNode | LeafNode)[]): ChildrenMap {
  const childrenMap: ChildrenMap = new Map();
  children.forEach((child, offset) => {
    childrenMap.set(child.getID(), { offset, child });
  });
  return childrenMap;
}

class Parser {
  private config: Config;
  private tokens: Token[];
  private rootNode: RootNode;
  private offset: number;
  private state: State;
  private nodeStack: NodeStack;
  private leafNode?: LeafNode;
  private childOffset: number;
  private leafContentBuffer: string[];

  constructor(config: Config, rootNode: RootNode) {
    this.config = config;
    this.rootNode = rootNode;
    this.tokens = [];
    this.offset = 0;
    this.state = State.ReadyForDocOpenTag;
    this.nodeStack = new NodeStack();
    this.childOffset = 0;
    this.leafContentBuffer = [];
  }

  parse(tokens: Token[]) {
    this.tokens = tokens;
    this.state = State.ReadyForDocOpenTag;
    while (this.offset < this.tokens.length) {
      this.step();
    }
  }

  private step() {
    const token = this.tokens[this.offset];
    switch (this.state) {
      case State.ReadyForDocOpenTag: {
        if (!(token instanceof OpenTagToken) || token.getType() !== 'Doc') {
          throw new Error(`Unexpected token at ${this.offset}, expecting OpenTagToken of type Doc.`);
        }
        const node = this.rootNode;
        const { id } = token.getAttributes();
        if (node.getID() !== id && node.getID()) {
          throw new Error(`Unexpected token at ${this.offset}, expecting OepnTagToken of type Doc with ID ${node.getID()}.`);
        }
        const childrenMap = buildChildrenMap(node.getChildren());
        this.nodeStack.push({ node, childrenMap });
        this.state = State.ReadyForTag;
        break;
      }
      case State.ReadyForTag: {
        if (token instanceof CloseTagToken) {
          this.nodeStack.pop();
          break;
        }
        if (!(token instanceof OpenTagToken)) {
          throw new Error(`Unexpected token at ${this.offset}, expecting OpenTagToken.`);
        }
        const { node: parent, childrenMap: siblingsMap } = this.nodeStack.get();
        const { id } = token.getAttributes();
        let node: Node;
        if (siblingsMap.has(id)) {
          const { child: _node, offset: nodeOffset } = siblingsMap.get(id)!;
          node = _node;
          while (this.childOffset < nodeOffset) {
            const siblings = parent.getChildren();
            const siblingToDelete = siblings[this.childOffset];
            parent.deleteChild(siblingToDelete);
            this.childOffset += 1;
          }
          this.childOffset += 1;
        } else {
          const NodeClass = this.config.getNodeClass(token.getType());
          node = new NodeClass(parent);
          if (!(node instanceof BranchNode || node instanceof LeafNode)) {
            throw new Error(`Unexpected token at ${this.offset}, expecting OpenTagToken of branch or leaf node.`);
          }
          node.setID(id);
          parent.insertChild(node, this.childOffset);
          this.childOffset += 1;
        }
        if (node instanceof BranchNode) {
          const childrenMap = buildChildrenMap(node.getChildren());
          this.nodeStack.push({ node, childrenMap });
        } else if (node instanceof LeafNode) {
          this.leafNode = node;
          this.state = State.ReadingLeafNodeContent;
        } else {
          throw new Error(`Unexpected token at ${this.offset}, OpenTagToken for a root node type should be the first token.`);
        }
        break;
      }
      case State.ReadingLeafNodeContent: {
        if (token instanceof CloseTagToken) {
          this.leafNode!.setContent(this.leafContentBuffer.join(''));
          this.leafNode = undefined;
          this.leafContentBuffer = [];
          this.state = State.ReadyForTag;
          break;
        }
        if (typeof token !== 'string') {
          throw new Error(`Unexpected token at ${this.offset}, expecting text token.`);
        }
        this.leafContentBuffer.push(token);
        break;
      }
    }
    this.offset += 1;
  }
}

export default Parser;
