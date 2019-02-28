import Node from './Node';

abstract class LeafNode extends Node {

  abstract getParent(): Node;
};

export default LeafNode;
