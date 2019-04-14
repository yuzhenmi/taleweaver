import Node from './Node';
import RootNode from './RootNode';
import LeafNode from './LeafNode';

type ParentNode = RootNode | BranchNode;
type ChildNode = BranchNode | LeafNode;

export default interface BranchNode extends Node {

  getParent(): ParentNode;

  getChildren(): ChildNode[];
}
