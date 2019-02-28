import Node from './Node';

abstract class BranchNode extends Node {

  abstract getParent(): Node;

  abstract getChildren(): Node[];
};

export default BranchNode;
