import BranchNode from '../tree/BranchNode';
import Token from '../token/Token';
import OpenTagToken from '../token/OpenTagToken';
import CloseTagToken from '../token/CloseTagToken';
import Element, { ResolvedPosition } from './Element';
import Doc from './Doc';
import InlineElement from './InlineElement';

type ParentElement = Doc;
type ChildElement = InlineElement;

export default abstract class BlockElement extends Element implements BranchNode {
  protected parent: ParentElement | null = null;
  protected children: ChildElement[] = [];

  setParent(parent: ParentElement | null) {
    this.parent = parent;
  }

  getParent() {
    if (!this.parent) {
      throw new Error('No parent has been set.');
    }
    return this.parent;
  }

  insertChild(child: ChildElement, offset: number | null = null) {
    child.setParent(this);
    if (offset === null) {
      this.children.push(child);
    } else {
      this.children.splice(offset, 0, child);
    }
    this.clearCache();
  }

  deleteChild(child: ChildElement) {
    const childOffset = this.children.indexOf(child);
    if (childOffset < 0) {
      throw new Error('Cannot delete child, child not found.');
    }
    child.setParent(null);
    this.children.splice(childOffset, 1);
    this.clearCache();
  }

  getChildren() {
    return this.children;
  }

  getSize() {
    if (this.size === undefined) {
      let size = 2;
      this.children.forEach(child => {
        size += child.getSize();
      });
      this.size = size;
    }
    return this.size;
  }

  toTokens() {
    const tokens: Token[] = [];
    tokens.push(new OpenTagToken(this.getType(), this.getID(), this.getAttributes()));
    this.children.forEach(child => {
      tokens.push(...child.toTokens());
    });
    tokens.push(new CloseTagToken());
    return tokens;
  }

  resolveOffset(offset: number, depth: number) {
    let cumulatedOffset = 1;
    for (let n = 0, nn = this.children.length; n < nn; n++) {
      const child = this.children[n];
      const childSize = child.getSize();
      if (cumulatedOffset + childSize > offset) {
        const resolvedPosition: ResolvedPosition = {
          element: this,
          depth,
          offset,
          parent: null,
          child: null,
        };
        const childResolvedPosition = child.resolveOffset(offset - cumulatedOffset, depth + 1);
        resolvedPosition.child = childResolvedPosition;
        childResolvedPosition.parent = resolvedPosition;
        return resolvedPosition;
      }
      cumulatedOffset += childSize;
    }
    this.size = undefined;
    throw new Error(`Offset ${offset} is out of range.`);
  }

  clearCache() {
    super.clearCache();
    if (this.parent) {
      this.parent.clearCache();
    }
  }

  abstract clone(): BlockElement;
};
