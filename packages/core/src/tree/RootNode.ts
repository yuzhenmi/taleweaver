import Node from './Node';
import BranchNode from './BranchNode';
import LeafNode from './LeafNode';

type ChildNode = BranchNode | LeafNode;

export default interface RootNode extends Node {

  getChildren(): ChildNode[];
}
