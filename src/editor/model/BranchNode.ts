import Node from './Node';
import ResolvedPosition from './ResolvedPosition';

abstract class BranchNode extends Node {

  abstract getParent(): Node;

  abstract appendChild(child: Node): void;

  abstract removeChild(child: Node): void;

  abstract getChildren(): Node[];

  abstract parentAt(offset: number): ResolvedPosition;

  abstract childAt(offset: number): ResolvedPosition;
};

export default BranchNode;
