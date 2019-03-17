export default abstract class LayoutNode {
  protected selectableSize: number;

  constructor(selectableSize: number) {
    this.selectableSize = selectableSize;
  }

  getSelectableSize(): number {
    return this.selectableSize;
  }
}
