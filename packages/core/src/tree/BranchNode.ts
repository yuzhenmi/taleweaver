import Node from './Node';

export default interface BranchNode extends Node {

  setParent(parent: Node | null): void;

  getParent(): Node;

  insertChild(child: Node, offset: number | undefined): void;

  deleteChild(child: Node): void;

  getChildren(): Node[];
}
