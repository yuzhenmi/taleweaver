import Node from './Node';
import BranchNode from './BranchNode';
import LeafNode from './LeafNode';
import RootNode from './RootNode';

class ResolvedPosition {
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

  getParent(): ResolvedPosition | null {
    if (this.node instanceof BranchNode) {
      return this.node.parentAt(this.offset);
    }
    if (this.node instanceof LeafNode) {
      return this.node.parentAt(this.offset);
    }
    return null;
  }

  getChild(): ResolvedPosition | null {
    if (this.node instanceof RootNode) {
      return this.node.childAt(this.offset);
    }
    if (this.node instanceof BranchNode) {
      return this.node.childAt(this.offset);
    }
    return null;
  }
}

export default ResolvedPosition;
