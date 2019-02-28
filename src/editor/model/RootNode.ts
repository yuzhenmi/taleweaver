import Node from './Node';

abstract class RootNode extends Node {

  abstract getChildren(): Node[];
};

export default RootNode;
