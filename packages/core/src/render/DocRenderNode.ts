import RenderNode from './RenderNode';
import BlockRenderNode from './BlockRenderNode';

export type Child = BlockRenderNode;

type OnUpdatedSubscriber = () => void;

export default class DocRenderNode extends RenderNode {
  protected children: Child[];
  protected onUpdatedSubscribers: OnUpdatedSubscriber[];

  constructor(id: string, selectableSize: number) {
    super(id, selectableSize);
    this.children = [];
    this.onUpdatedSubscribers = [];
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

  subscribeOnUpdated(onUpdatedSubscriber: OnUpdatedSubscriber) {
    this.onUpdatedSubscribers.push(onUpdatedSubscriber);
  }

  onUpdated() {
    this.onUpdatedSubscribers.forEach(onUpdatedSubscriber => {
      onUpdatedSubscriber();
    });
  }
}
