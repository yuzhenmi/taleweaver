import LayoutNode from './LayoutNode';

export default abstract class Box extends LayoutNode {
  protected renderNodeID: string;
  protected width: number;
  protected height: number;
  protected version: number;

  constructor(renderNodeID: string, selectableSize: number, width: number, height: number) {
    super(selectableSize);
    this.renderNodeID = renderNodeID;
    this.width = width;
    this.height = height;
    this.version = 0;
  }

  getRenderNodeID(): string {
    return this.renderNodeID;
  }

  getWidth(): number {
    return this.width;
  }

  getHeight(): number {
    return this.height;
  }

  setVersion(version: number) {
    this.version = version;
  }

  getVersion(): number {
    return this.version;
  }
}
