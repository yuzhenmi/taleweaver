import Node from './Node';
import RootNode from './RootNode';
import BranchNode from './BranchNode';
import LeafNode from './LeafNode';

class TreePosition {
  private node: Node;
  private offset: number;

  constructor(node: Node, offset: number) {
    this.node = node;
    this.offset = offset;
  }

  getNode(): Node {
    return this.node;
  }

  getOffset(): number {
    return this.offset;
  }

  toParent(): TreePosition | null {
    if (this.node instanceof BranchNode) {
      return this.node.parentAt(this.offset);
    }
    if (this.node instanceof LeafNode) {
      return this.node.parentAt(this.offset);
    }
    return null;
  }

  toChild(): TreePosition | null {
    if (this.node instanceof RootNode) {
      return this.node.childAt(this.offset);
    }
    if (this.node instanceof BranchNode) {
      return this.node.childAt(this.offset);
    }
    return null;
  }
}

export default TreePosition;
