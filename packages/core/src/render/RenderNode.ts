export default abstract class RenderNode {
  protected selectableSize: number;

  constructor(selectableSize: number) {
    this.selectableSize = selectableSize;
  }

  abstract getType(): string;

  getSelectableSize(): number {
    return this.selectableSize;
  }
}
