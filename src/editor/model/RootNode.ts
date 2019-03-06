import Node from './Node';
import BranchNode from './BranchNode';
import LeafNode from './LeafNode';

export type Child = BranchNode | LeafNode;

export default abstract class RootNode extends Node {
  private children: Child[];

  constructor() {
    super();
    this.children = [];
  }

  getChildren(): Child[] {
    return this.children;
  }

  insertChild(child: Child, offset: number) {
    this.children.splice(offset, 0, child);
  }

  deleteChild(child: Child) {
    const childOffset = this.children.indexOf(child);
    if (childOffset < 0) {
      throw new Error('Cannot delete child, child not found.');
    }
    this.children.splice(childOffset, 1);
  }
};
