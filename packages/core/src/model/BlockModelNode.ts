import CloseTagToken from '../state/CloseTagToken';
import OpenTagToken from '../state/OpenTagToken';
import Token from '../state/Token';
import DocNode from './DocModelNode';
import InlineNode from './InlineModelNode';
import ModelNode, { ModelPosition } from './ModelNode';

type ParentNode = DocNode;
type ChildNode = InlineNode<any>;

export default abstract class BlockModelNode<A> extends ModelNode<A, ParentNode, ChildNode> {

  isRoot() {
    return false;
  }

  isLeaf() {
    return false;
  }

  getSize() {
    if (this.size === undefined) {
      this.size = this.childNodes!.reduce((size, childNode) => size + childNode.getSize(), 2);
    }
    return this.size!;
  }

  toTokens() {
    const tokens: Token[] = [];
    tokens.push(new OpenTagToken(this.getType(), this.getID(), this.getAttributes()));
    this.childNodes!.forEach(childNode => {
      tokens.push(...childNode.toTokens());
    });
    tokens.push(new CloseTagToken());
    return tokens;
  }

  resolveOffset(offset: number, depth: number) {
    let cumulatedOffset = 1;
    for (let n = 0, nn = this.childNodes!.length; n < nn; n++) {
      const childNode = this.childNodes![n];
      const childSize = childNode.getSize();
      if (cumulatedOffset + childSize > offset) {
        const position: ModelPosition = {
          node: this,
          depth,
          offset,
        };
        const childPosition = childNode.resolveOffset(offset - cumulatedOffset, depth + 1);
        position.child = childPosition;
        childPosition.parent = position;
        return position;
      }
      cumulatedOffset += childSize;
    }
    throw new Error(`Offset ${offset} is out of range.`);
  }

  clearCache() {
    super.clearCache();
    if (this.parent) {
      this.parent.clearCache();
    }
  }
};
