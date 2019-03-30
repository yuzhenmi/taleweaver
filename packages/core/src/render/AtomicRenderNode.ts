import RenderNode from './RenderNode';
import InlineRenderNode from './InlineRenderNode';

export type Parent = InlineRenderNode;

export default abstract class AtomicRenderNode extends RenderNode {
  protected version: number;
  protected parent: Parent;

  constructor(id: string, parent: Parent) {
    super(id);
    this.version = 0;
    this.parent = parent;
  }

  setVersion(version: number) {
    this.version = version;
  }

  getVersion(): number {
    return this.version;
  }

  getParent(): Parent {
    return this.parent;
  }

  abstract getBreakable(): boolean;
}
