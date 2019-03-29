import LayoutNode from './LayoutNode';
import generateRandomString from './helpers/generateRandomString';

export default abstract class Box extends LayoutNode {
  protected renderNodeID: string;

  constructor(renderNodeID: string) {
    super(`${renderNodeID}-${generateRandomString()}`);
    this.renderNodeID = renderNodeID;
  }

  getRenderNodeID(): string {
    return this.renderNodeID;
  }

  abstract getWidth(): number;

  abstract getHeight(): number;
}
