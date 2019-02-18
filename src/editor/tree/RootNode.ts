import Node from './Node';
import TreePosition from './TreePosition';

abstract class RootNode extends Node {

  abstract getChildren(): Node[];

  abstract childAt(offset: number): TreePosition;
};

export default RootNode;
