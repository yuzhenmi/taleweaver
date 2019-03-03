import Node from './Node';
import BranchNode from './BranchNode';

export type Parent = BranchNode;

export default abstract class LeafNode extends Node {
  private parent: Parent;
  private content: string;

  constructor(parent: Parent) {
    super();
    this.parent = parent;
    this.content = '';
  }

  getParent(): Parent {
    return this.parent;
  }

  setContent(content: string) {
    this.content = content;
  }

  getContent(): string {
    return this.content;
  }
};
