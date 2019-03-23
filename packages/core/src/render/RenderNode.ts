export default abstract class RenderNode {
  protected id: string;
  protected selectableSize: number;

  constructor(id: string, selectableSize: number) {
    this.id = id;
    this.selectableSize = selectableSize;
  }

  abstract getType(): string;

  getID(): string {
    return this.id;
  }

  getSelectableSize(): number {
    return this.selectableSize;
  }
}
