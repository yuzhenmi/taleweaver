import LeafNode from '../model/LeafNode';
import RenderNode from './RenderNode';
import BlockRenderNode from './BlockRenderNode';
import AtomicRenderNode from './AtomicRenderNode';

export type Parent = BlockRenderNode;
export type Child = AtomicRenderNode;

export default abstract class InlineRenderNode extends RenderNode {
  protected version: number;
  protected parent: Parent;
  protected selectableSize?: number;
  protected modelSize?: number;
  protected children: Child[];

  constructor(id: string, parent: Parent) {
    super(id);
    this.version = 0;
    this.parent = parent;
    this.children = [];
  }

  setVersion(version: number) {
    this.version = version;
  }

  getVersion(): number {
    return this.version;
  }

  getSelectableSize(): number {
    if (this.selectableSize === undefined) {
      let selectableSize = 0;
      this.children.forEach(child => {
        selectableSize += child.getSelectableSize();
      });
      this.selectableSize = selectableSize;
    }
    return this.selectableSize;
  }

  getParent(): Parent {
    return this.parent;
  }

  getChildren(): Child[] {
    return this.children;
  }

  insertChild(child: Child, offset: number) {
    this.children.splice(offset, 0, child);
  }

  deleteChild(child: Child) {
    const childOffset = this.children.indexOf(child);
    if (childOffset < 0) {
      throw new Error('Cannot delete child, child not found.');
    }
    this.children.splice(childOffset, 1);
  }

  onModelUpdated(node: LeafNode) {
    this.selectableSize = undefined;
    this.modelSize = undefined;
  }

  getModelSize(): number {
    if (this.modelSize === undefined) {
      let modelSize = 2;
      this.children.forEach(child => {
        modelSize += child.getModelSize();
      });
      this.modelSize = modelSize;
    }
    return this.modelSize;
  }

  convertSelectableOffsetToModelOffset(selectableOffset: number): number {
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
}
