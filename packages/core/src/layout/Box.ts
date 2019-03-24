import LayoutNode from './LayoutNode';

export default abstract class Box extends LayoutNode {
  protected renderNodeID: string;

  constructor(renderNodeID: string) {
    super();
    this.renderNodeID = renderNodeID;
  }

  getRenderNodeID(): string {
    return this.renderNodeID;
  }

  abstract getWidth(): number;

  abstract getHeight(): number;
}
