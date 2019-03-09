import RenderNode from './RenderNode';
import InlineRenderNode from './InlineRenderNode';

export type Parent = InlineRenderNode;

export default abstract class AtomicRenderNode extends RenderNode {
  protected parent: Parent;
  protected breakable: boolean;

  constructor(parent: Parent, selectableSize: number, breakable: boolean) {
    super(selectableSize);
    this.parent = parent;
    this.breakable = breakable;
  }

  getParent(): Parent {
    return this.parent;
  }
}
