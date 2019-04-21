import Node from '../tree/Node';

export default abstract class LayoutNode implements Node {
  protected id: string;
  protected version: number;
  protected selectableSize?: number;
  protected width?: number;
  protected height?: number;

  constructor(id: string) {
    this.id = id;
    this.version = 0;
  }

  getID(): string {
    return this.id;
  }

  setVersion(version: number) {
    this.version = version;
  }

  getVersion(): number {
    return this.version;
  }

  abstract getSelectableSize(): number;

  abstract getWidth(): number;

  abstract getHeight(): number;

  protected clearCache() {
    this.width = undefined;
    this.height = undefined;
    this.selectableSize = undefined;
  }
}
