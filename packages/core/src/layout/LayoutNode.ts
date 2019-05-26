import Node from '../tree/Node';

export default abstract class LayoutNode implements Node {
  protected id: string;
  protected version: number;
  protected selectableSize?: number;
  protected width?: number;
  protected height?: number;
  protected deleted: boolean = false;

  constructor(id: string) {
    this.id = id;
    this.version = 0;
  }

  getID(): string {
    return this.id;
  }

  abstract setVersion(version: number): void;

  getVersion(): number {
    return this.version;
  }

  markAsDeleted() {
    this.deleted = true;
  }

  isDeleted() {
    return this.deleted;
  }

  abstract getSelectableSize(): number;

  abstract getWidth(): number;

  abstract getHeight(): number;

  abstract getPaddingTop(): number;

  abstract getPaddingBottom(): number;

  abstract getPaddingLeft(): number;

  abstract getPaddingRight(): number;

  protected clearCache() {
    this.width = undefined;
    this.height = undefined;
    this.selectableSize = undefined;
  }
}
