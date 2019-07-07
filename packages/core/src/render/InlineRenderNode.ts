import BranchNode from '../tree/BranchNode';
import InlineElement from '../model/InlineElement';
import RenderNode, { ResolvedPosition } from './RenderNode';
import BlockRenderNode from './BlockRenderNode';
import AtomicRenderNode from './AtomicRenderNode';

export type Parent = BlockRenderNode;
export type Child = AtomicRenderNode;

export default abstract class InlineRenderNode extends RenderNode implements BranchNode {
  protected parent: Parent | null = null;
  protected children: Child[] = [];

  getVersion() {
    return this.version;
  }

  getSize() {
    if (this.size === undefined) {
      let size = 0;
      this.children.forEach(child => {
        size += child.getSize();
      });
      this.size = size;
    }
    return this.size;
  }

  setParent(parent: Parent | null) {
    this.parent = parent;
  }

  getParent() {
    if (!this.parent) {
      throw new Error('No parent has been set.');
    }
    return this.parent;
  }

  getChildren() {
    return this.children;
  }

  insertChild(child: Child, offset: number | null = null) {
    child.setParent(this);
    if (offset === null) {
      this.children.push(child);
    } else {
      this.children.splice(offset, 0, child);
    }
    this.clearCache();
  }

  deleteChild(child: Child) {
    const childOffset = this.children.indexOf(child);
    if (childOffset < 0) {
      throw new Error('Cannot delete child, child not found.');
    }
    child.setParent(null);
    this.children.splice(childOffset, 1);
    this.clearCache();
  }

  getPreviousSibling() {
    const siblings = this.getParent().getChildren();
    const offset = siblings.indexOf(this);
    if (offset < 0) {
      throw new Error(`Inline render node is not found in parent.`);
    }
    if (offset > 0) {
      return siblings[offset - 1];
    }
    const parentPreviousSibling = this.getParent().getPreviousSibling();
    if (!parentPreviousSibling) {
      return null;
    }
    const parentPreviousSiblingChildren = parentPreviousSibling.getChildren();
    return parentPreviousSiblingChildren[parentPreviousSiblingChildren.length - 1];
  }

  getNextSibling() {
    const siblings = this.getParent().getChildren();
    const offset = siblings.indexOf(this);
    if (offset < 0) {
      throw new Error(`Inline render node is not found in parent.`);
    }
    if (offset < siblings.length - 1) {
      return siblings[offset + 1];
    }
    const parentNextSibling = this.getParent().getNextSibling();
    if (!parentNextSibling) {
      return null;
    }
    const parentNextSiblingChildren = parentNextSibling.getChildren();
    return parentNextSiblingChildren[0];
  }

  onModelUpdated(element: InlineElement) {
    this.clearCache();
  }

  getModelSize() {
    if (this.modelSize === undefined) {
      let modelSize = 2;
      this.children.forEach(child => {
        modelSize += child.getModelSize();
      });
      this.modelSize = modelSize;
    }
    return this.modelSize;
  }

  getModelOffset(offset: number) {
    let cumulatedSelectableOffset = 0;
    let cumulatedModelOffset = 1;
    for (let n = 0, nn = this.children.length; n < nn; n++) {
      const child = this.children[n];
      const childSelectableOffset = child.getSize();
      if (cumulatedSelectableOffset + childSelectableOffset > offset) {
        return cumulatedModelOffset + child.getModelOffset(offset - cumulatedSelectableOffset);
      }
      cumulatedSelectableOffset += childSelectableOffset;
      cumulatedModelOffset += child.getModelSize();
    }
    throw new Error(`Offset ${offset} is out of range.`);
  }

  resolveOffset(offset: number, depth: number) {
    let cumulatedOffset = 0;
    for (let n = 0, nn = this.children.length; n < nn; n++) {
      const child = this.children[n];
      const childSize = child.getSize();
      if (cumulatedOffset + childSize > offset) {
        const resolvedPosition: ResolvedPosition = {
          renderNode: this,
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
    throw new Error(`Offset ${offset} is out of range.`);
  }
}
