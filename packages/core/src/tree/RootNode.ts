import Node from './Node';

export default interface RootNode extends Node {

  insertChild(child: Node, offset: number | undefined): void;

  deleteChild(child: Node): void;

  getChildren(): Node[];
}
