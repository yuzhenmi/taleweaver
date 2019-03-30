import AtomicRenderNode, { Parent } from './AtomicRenderNode';

export default class TextAtomicRenderNode extends AtomicRenderNode {
  protected content: string;
  protected breakable: boolean;

  constructor(id: string, parent: Parent, content: string, breakable: boolean) {
    super(id, parent);
    this.content = content;
    this.breakable = breakable;
  }

  getType(): string {
    return 'TextAtomicRenderNode';
  }

  getSelectableSize(): number {
    return this.content.length;
  }

  getContent(): string {
    return this.content;
  }

  getBreakable(): boolean {
    return this.breakable;
  }
}
