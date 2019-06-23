import LeafNode from '../tree/LeafNode';
import RenderNode from './RenderNode';
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

  abstract getBreakable(): boolean;

  getModelSize() {
    return this.getSelectableSize();
  }

  convertSelectableOffsetToModelOffset(selectableOffset: number) {
    return selectableOffset;
  }
}
