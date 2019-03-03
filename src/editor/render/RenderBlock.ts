import Node from './RenderNode';
import RenderDoc from './RenderDoc';
import RenderInline from './RenderInline';

export type Parent = RenderDoc;
export type Child = RenderInline;

export default class RenderBlock extends Node {
  private parent: Parent;
  private children: Child[];

  constructor(parent: Parent, id: string, size: number, selectableSize: number) {
    super(id, size, selectableSize);
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
