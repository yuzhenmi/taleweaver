import Editor from '../Editor';
import LayoutNode from './LayoutNode';
import generateID from '../utils/generateID';

export default abstract class Box extends LayoutNode {
  protected renderNodeID: string;

  constructor(editor: Editor, renderNodeID: string) {
    const id = `${renderNodeID}-${generateID()}`;
    super(editor, id);
    this.renderNodeID = renderNodeID;
  }

  getRenderNodeID() {
    return this.renderNodeID;
  }
}
