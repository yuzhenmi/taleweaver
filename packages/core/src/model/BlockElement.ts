import BranchNode from '../tree/BranchNode';
import Element from './Element';
import Doc from './Doc';
import InlineElement from './InlineElement';

type ParentElement = Doc;
type ChildElement = InlineElement;

export default abstract class BlockElement extends Element implements BranchNode {
  protected parent: ParentElement | null = null;
  protected children: ChildElement[] = [];

  setVersion(version: number) {
    if (this.version < version) {
      this.version = version;
      if (this.parent) {
        this.parent.setVersion(version);
      }
    }
  }

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
};
