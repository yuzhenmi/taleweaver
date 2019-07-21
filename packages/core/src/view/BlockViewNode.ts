import LineNode from './LineViewNode';
import PageNode from './PageViewNode';
import ViewNode from './ViewNode';

export type ParentNode = PageNode;
export type ChildNode = LineNode;

export default abstract class BlockViewNode extends ViewNode<ParentNode, ChildNode> {
  protected size?: number;

  isRoot() {
    return false;
  }

  isLeaf() {
    return false;
  }

  getSize() {
    if (this.size === undefined) {
      this.size = this.getChildNodes().reduce((size, childNode) => size + childNode.getSize(), 0);
    }
    return this.size;
  }

  clearCache() {
    this.size = undefined;
  }
}
