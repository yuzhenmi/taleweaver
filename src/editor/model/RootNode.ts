import Node from './Node';
import ResolvedPosition from './ResolvedPosition';

abstract class RootNode extends Node {

  abstract appendChild(child: Node): void;

  abstract removeChild(child: Node): void;

  abstract getChildren(): Node[];

  abstract childAt(offset: number): ResolvedPosition;
};

export default RootNode;
