import RenderNode from './RenderNode';
import BlockRenderNode from './BlockRenderNode';

export type Child = BlockRenderNode;

export default class DocRenderNode extends RenderNode {
  protected children: Child[];

  constructor(id: string, selectableSize: number) {
    super(id, selectableSize);
    this.children = [];
  }

  getType(): string {
    return 'DocRenderNode';
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
