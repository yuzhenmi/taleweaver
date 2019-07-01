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

  getSelectableSize() {
    if (this.selectableSize === undefined) {
      let selectableSize = 0;
      this.children.forEach(child => {
        selectableSize += child.getSelectableSize();
      });
      this.selectableSize = selectableSize;
    }
    return this.selectableSize;
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

  convertSelectableOffsetToModelOffset(selectableOffset: number) {
    let cumulatedSelectableOffset = 0;
    let cumulatedModelOffset = 1;
    for (let n = 0, nn = this.children.length; n < nn; n++) {
      const child = this.children[n];
      const childSelectableOffset = child.getSelectableSize();
      if (cumulatedSelectableOffset + childSelectableOffset > selectableOffset) {
        return cumulatedModelOffset + child.convertSelectableOffsetToModelOffset(selectableOffset - cumulatedSelectableOffset);
      }
      cumulatedSelectableOffset += childSelectableOffset;
      cumulatedModelOffset += child.getModelSize();
    }
    throw new Error(`Selectable offset ${selectableOffset} is out of range.`);
  }

  resolveSelectableOffset(selectableOffset: number, depth: number) {
    let cumulatedOffset = 0;
    for (let n = 0, nn = this.children.length; n < nn; n++) {
      const child = this.children[n];
      const childSize = child.getSelectableSize();
      if (cumulatedOffset + childSize > selectableOffset) {
        const resolvedPosition: ResolvedPosition = {
          renderNode: this,
          depth,
          offset: selectableOffset,
          parent: null,
          child: null,
        };
        const childResolvedPosition = child.resolveSelectableOffset(selectableOffset - cumulatedOffset, depth + 1);
        resolvedPosition.child = childResolvedPosition;
        childResolvedPosition.parent = resolvedPosition;
        return resolvedPosition;
      }
      cumulatedOffset += childSize;
    }
    throw new Error(`Selectable offset ${selectableOffset} is out of range.`);
  }
}
