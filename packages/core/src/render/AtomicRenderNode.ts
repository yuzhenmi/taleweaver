import LeafNode from '../tree/LeafNode';
import RenderNode, { ResolvedPosition } from './RenderNode';
import InlineRenderNode from './InlineRenderNode';

export type Parent = InlineRenderNode;

export default abstract class AtomicRenderNode extends RenderNode implements LeafNode {
  protected parent: Parent | null = null;

  setParent(parent: Parent | null) {
    this.parent = parent;
  }

  getParent() {
    if (!this.parent) {
      throw new Error('No parent has been set.');
    }
    return this.parent;
  }

  getPreviousSibling() {
    const siblings = this.getParent().getChildren();
    const offset = siblings.indexOf(this);
    if (offset < 0) {
      throw new Error(`Atomic render node is not found in parent.`);
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
      throw new Error(`Atomic render node is not found in parent.`);
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

  abstract getBreakable(): boolean;

  getModelSize() {
    return this.getSelectableSize();
  }

  convertSelectableOffsetToModelOffset(selectableOffset: number) {
    return selectableOffset;
  }

  resolveSelectableOffset(selectableOffset: number, depth: number) {
    if (selectableOffset >= this.getSelectableSize()) {
      throw new Error(`Selectable offset ${selectableOffset} is out of range.`);
    }
    const resolvedPosition: ResolvedPosition = {
      renderNode: this,
      depth,
      offset: selectableOffset,
      parent: null,
      child: null,
    };
    return resolvedPosition;
  }
}
