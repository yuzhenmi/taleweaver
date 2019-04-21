import LeafNode from '../tree/LeafNode';
import Element from './Element';
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

  getContent(): string {
    return this.content;
  }

  getSize() {
    if (this.size === undefined) {
      this.size = 2 + this.content.length;
    }
    return this.size;
  }
};
