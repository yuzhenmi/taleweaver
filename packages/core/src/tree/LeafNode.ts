import Node from './Node';

export default interface LeafNode extends Node {

  setParent(parent: Node | null): void;

  getParent(): Node;
}
