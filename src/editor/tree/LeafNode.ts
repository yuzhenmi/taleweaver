import Node from './Node';
import TreePosition from './TreePosition';

abstract class LeafNode extends Node {

  abstract getParent(): Node;

  abstract getPreviousSibling(): Node | null;

  abstract getNextSibling(): Node | null;

  abstract parentAt(offset: number): TreePosition;
};

export default LeafNode;
