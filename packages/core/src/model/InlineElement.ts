import LeafNode from '../tree/LeafNode';
import Token from '../token/Token';
import OpenTagToken from '../token/OpenTagToken';
import CloseTagToken from '../token/CloseTagToken';
import Element, { ResolvedPosition } from './Element';
import BlockElement from './BlockElement';

type ParentElement = BlockElement;

export default abstract class InlineElement extends Element implements LeafNode {
  protected parent: ParentElement | null = null;
  protected content: string = '';

  setParent(parent: ParentElement | null) {
    this.parent = parent;
  }

  getParent() {
    if (!this.parent) {
      throw new Error('No parent has been set.');
    }
    return this.parent;
  }

  setContent(content: string) {
    this.content = content;
    this.clearCache();
  }

  getContent() {
    return this.content;
  }

  getSize() {
    if (this.size === undefined) {
      this.size = 2 + this.content.length;
    }
    return this.size;
  }
  
  toTokens() {
    const tokens: Token[] = [];
    tokens.push(new OpenTagToken(this.getType(), this.getID(), this.getAttributes()));
    tokens.push(...this.content.split(''));
    tokens.push(new CloseTagToken());
    return tokens;
  }

  resolveOffset(offset: number, depth: number) {
    if (offset >= this.getSize()) {
      throw new Error(`Offset ${offset} is out of range.`);
    }
    const resolvedPosition: ResolvedPosition = {
      element: this,
      depth,
      offset,
      parent: null,
      child: null,
    };
    return resolvedPosition;
  }

  clearCache() {
    super.clearCache();
    if (this.parent) {
      this.parent.clearCache();
    }
  }
};
