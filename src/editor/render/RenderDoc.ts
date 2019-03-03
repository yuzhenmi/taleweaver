import Node from './RenderNode';
import RenderBlock from './RenderBlock';

export type Child = RenderBlock;

export default class RenderDoc extends Node {
  private children: Child[];

  constructor(id: string) {
    super(id);
    this.children = [];
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
