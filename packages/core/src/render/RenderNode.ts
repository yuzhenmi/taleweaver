export default abstract class RenderNode {
  protected id: string;
  protected selectableSize: number;
  protected version: number;

  constructor(id: string, selectableSize: number) {
    this.id = id;
    this.selectableSize = selectableSize;
    this.version = 0;
  }

  abstract getType(): string;

  getID(): string {
    return this.id;
  }

  getSelectableSize(): number {
    return this.selectableSize;
  }

  setVersion(version: number) {
    this.version = version;
  }

  getVersion(): number {
    return this.version;
  }
}
