import Node from '../tree/Node';

export default abstract class RenderNode implements Node {
  protected id: string;
  protected version: number;
  protected selectableSize?: number;
  protected modelSize?: number;

  constructor(id: string) {
    this.id = id;
    this.version = 0;
  }

  abstract getType(): string;

  getID(): string {
    return this.id;
  }

  abstract setVersion(version: number): void;

  getVersion(): number {
    return this.version;
  }

  abstract getSelectableSize(): number;

  abstract getModelSize(): number;

  abstract convertSelectableOffsetToModelOffset(selectableOffset: number): number;

  protected clearCache() {
    this.selectableSize = undefined;
    this.modelSize = undefined;
  }
}
