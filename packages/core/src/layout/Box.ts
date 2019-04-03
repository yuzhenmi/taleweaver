import LayoutNode from './LayoutNode';
import generateID from '../helpers/generateID';

export default abstract class Box extends LayoutNode {
  protected renderNodeID: string;

  constructor(renderNodeID: string) {
    super(`${renderNodeID}-${generateID()}`);
    this.renderNodeID = renderNodeID;
  }

  getRenderNodeID(): string {
    return this.renderNodeID;
  }
}
