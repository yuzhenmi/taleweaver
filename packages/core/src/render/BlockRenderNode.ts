import RenderNode from './RenderNode';
import DocRenderNode from './DocRenderNode';
import InlineRenderNode from './InlineRenderNode';

export type Parent = DocRenderNode;
export type Child = InlineRenderNode;

export default abstract class BlockRenderNode extends RenderNode {
  protected width: number;
  protected parent: Parent;
  protected children: Child[];

  constructor(id: string, parent: Parent, selectableSize: number, width: number) {
    super(id, selectableSize);
    this.width = width;
    this.parent = parent;
    this.children = [];
  }

  getWidth(): number {
    return this.width;
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
