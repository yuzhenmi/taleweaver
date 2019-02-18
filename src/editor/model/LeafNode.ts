import Node from './Node';
import ResolvedPosition from './ResolvedPosition';

abstract class LeafNode extends Node {

  abstract getParent(): Node;

  abstract parentAt(offset: number): ResolvedPosition;
};

export default LeafNode;
