import RenderNode from './RenderNode';
import BlockRenderNode from './BlockRenderNode';

export type Child = BlockRenderNode;

type OnUpdatedSubscriber = () => void;

export default class DocRenderNode extends RenderNode {
  protected width: number;
  protected height: number;
  protected padding: number;
  protected children: Child[];
  protected onUpdatedSubscribers: OnUpdatedSubscriber[];

  constructor(id: string, selectableSize: number, width: number, height: number, padding: number) {
    super(id, selectableSize);
    this.width = width;
    this.height = height;
    this.padding = padding;
    this.children = [];
    this.onUpdatedSubscribers = [];
  }

  getType(): string {
    return 'DocRenderNode';
  }

  getWidth(): number {
    return this.width;
  }

  getHeight(): number {
    return this.height;
  }

  getPadding(): number {
    return this.padding;
  }

  getInnerWidth(): number {
    return this.width - this.padding - this.padding;
  }

  getInnerHeight(): number {
    return this.height - this.padding - this.padding;
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

  subscribeOnUpdated(onUpdatedSubscriber: OnUpdatedSubscriber) {
    this.onUpdatedSubscribers.push(onUpdatedSubscriber);
  }

  onUpdated() {
    this.onUpdatedSubscribers.forEach(onUpdatedSubscriber => {
      onUpdatedSubscriber();
    });
  }
}
