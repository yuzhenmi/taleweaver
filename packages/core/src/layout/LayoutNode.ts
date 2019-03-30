export default abstract class LayoutNode {
  protected id: string;

  constructor(id: string) {
    this.id = id;
  }

  getID(): string {
    return this.id;
  }

  abstract getSelectableSize(): number;

  abstract getWidth(): number;

  abstract getHeight(): number;
}
