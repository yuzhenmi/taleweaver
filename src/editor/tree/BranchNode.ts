import Node from './Node';
import TreePosition from './TreePosition';

abstract class BranchNode extends Node {

  abstract getParent(): Node;

  abstract getPreviousSibling(): Node | null;

  abstract getNextSibling(): Node | null;

  abstract getChildren(): Node[];

  abstract parentAt(offset: number): TreePosition;

  abstract childAt(offset: number): TreePosition;
};

export default BranchNode;
