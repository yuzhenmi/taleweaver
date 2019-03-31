export default abstract class RenderNode {
  protected id: string;

  constructor(id: string) {
    this.id = id;
  }

  abstract getType(): string;

  getID(): string {
    return this.id;
  }

  abstract getSelectableSize(): number;

  abstract getModelSize(): number;

  abstract convertSelectableOffsetToModelOffset(selectableOffset: number): number;
}
