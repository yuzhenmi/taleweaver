export default abstract class LayoutNode {
  protected selectableSize: number;

  constructor(selectableSize: number) {
    this.selectableSize = selectableSize;
  }

  getSelectableSize(): number {
    return this.selectableSize;
  }

  adjustSelectableSize(delta: number) {
    this.selectableSize += delta;
  }

  abstract setParent(parent: LayoutNode): void;

  abstract getChildren(): LayoutNode[];

  abstract insertChild(child: LayoutNode, offset: number): void;

  abstract deleteChild(child: LayoutNode): void;
}
