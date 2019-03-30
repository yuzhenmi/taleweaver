import BranchNode from '../model/BranchNode';
import RenderNode from './RenderNode';
import DocRenderNode from './DocRenderNode';
import InlineRenderNode from './InlineRenderNode';

export type Parent = DocRenderNode;
export type Child = InlineRenderNode;

export default abstract class BlockRenderNode extends RenderNode {
  protected version: number;
  protected parent: Parent;
  protected selectableSize?: number;
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

  abstract onModelUpdated(node: BranchNode): void;
}
