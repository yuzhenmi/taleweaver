import RenderNode from './RenderNode';
import BlockRenderNode from './BlockRenderNode';
import AtomicRenderNode from './AtomicRenderNode';

export type Parent = BlockRenderNode;
export type Child = AtomicRenderNode;

export default abstract class InlineRenderNode extends RenderNode {
  protected parent: Parent;
  protected children: Child[];

  constructor(parent: Parent, selectableSize: number) {
    super(selectableSize);
    this.parent = parent;
    this.children = [];
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
}
