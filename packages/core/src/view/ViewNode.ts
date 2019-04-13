import LayoutNode from '../layout/LayoutNode';

export default abstract class ViewNode {
  protected id: string;
  protected selectableSize?: number;

  constructor(id: string) {
    this.id = id;
  }

  getID(): string {
    return this.id;
  }

  abstract getDOMContainer(): HTMLElement;

  getSelectableSize(): number {
    if (this.selectableSize === undefined) {
      throw new Error('View node has not yet been initialized with selectable size.');
    }
    return this.selectableSize;
  }

  abstract onLayoutUpdated(layoutNode: LayoutNode): void;

  abstract onDeleted(): void;

  abstract resolveSelectableOffsetToNodeOffset(selectableOffset: number): [Node, number];
}
