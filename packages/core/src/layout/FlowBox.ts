import Editor from '../Editor';
import LayoutNode from './LayoutNode';
import generateID from '../utils/generateID';

export default abstract class FlowBox extends LayoutNode {

  constructor(editor: Editor) {
    const id = generateID();
    super(editor, id);
  }
}
