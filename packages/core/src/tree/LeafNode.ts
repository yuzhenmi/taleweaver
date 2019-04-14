import Node from './Node';
import RootNode from './RootNode';
import BranchNode from './BranchNode';

type ParentNode = RootNode | BranchNode;

export default interface LeafNode extends Node {

  getParent(): ParentNode;
}
