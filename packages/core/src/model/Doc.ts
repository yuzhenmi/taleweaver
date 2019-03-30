
import Node from './Node';
import BranchNode from './BranchNode';

export type Child = BranchNode;

type OnUpdatedSubscriber = () => void;

export default class Doc extends Node {
  protected children: Child[];
  protected onUpdatedSubscribers: OnUpdatedSubscriber[];

  constructor() {
    super();
    this.children = [];
    this.onUpdatedSubscribers = [];
  }

  getType(): string {
    return 'Doc';
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

  getWidth(): number {
    return 816;
  }

  getHeight(): number {
    return 1056;
  }

  getPadding(): number {
    return 60;
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
