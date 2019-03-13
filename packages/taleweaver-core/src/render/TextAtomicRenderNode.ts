import AtomicRenderNode, { Parent } from './AtomicRenderNode';

export default class TextAtomicRenderNode extends AtomicRenderNode {
  protected content: string;

  constructor(parent: Parent, content: string, breakable: boolean) {
    super(parent, content.length, breakable);
    this.content = content;
  }

  getType(): string {
    return 'TextAtomicRenderNode';
  }

  getContent(): string {
    return this.content;
  }
}
