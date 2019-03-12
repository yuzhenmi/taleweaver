export default abstract class Box {
  protected selectableSize: number;
  protected width: number;
  protected height: number;

  constructor(selectableSize: number, width: number, height: number) {
    this.selectableSize = selectableSize;
    this.width = width;
    this.height = height;
  }

  getWidth(): number {
    return this.width;
  }

  getHeight(): number {
    return this.height;
  }
}
