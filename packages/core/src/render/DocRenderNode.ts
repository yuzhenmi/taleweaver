import Doc from '../model/Doc';
import RenderNode from './RenderNode';
import BlockRenderNode from './BlockRenderNode';

export type Child = BlockRenderNode;

type OnUpdatedSubscriber = () => void;

export default class DocRenderNode extends RenderNode {
  protected version: number;
  protected selectableSize?: number;
  protected width: number;
  protected height: number;
  protected padding: number;
  protected children: Child[];
  protected onUpdatedSubscribers: OnUpdatedSubscriber[];

  constructor(id: string) {
    super(id);
    this.version = 0;
    this.width = 0;
    this.height = 0;
    this.padding = 0;
    this.children = [];
    this.onUpdatedSubscribers = [];
  }

  getType(): string {
    return 'DocRenderNode';
  }

  setVersion(version: number) {
    this.version = version;
  }

  getVersion(): number {
    return this.version;
  }

  getSelectableSize() {
    if (this.selectableSize === undefined) {
      let selectableSize = 0;
      this.children.forEach(child => {
        selectableSize += child.getSelectableSize();
      });
      this.selectableSize = selectableSize;
    }
    return this.selectableSize;
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

  onModelUpdated(node: Doc) {
    this.id = node.getID();
    this.width = node.getWidth();
    this.height = node.getHeight();
    this.padding = node.getPadding();
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
