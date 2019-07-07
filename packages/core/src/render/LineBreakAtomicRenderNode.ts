import Editor from '../Editor';
import AtomicRenderNode from './AtomicRenderNode';

export default class LineBreakAtomicRenderNode extends AtomicRenderNode {

  constructor(editor: Editor, id: string) {
    super(editor, id);
  }

  getType() {
    return 'LineBreakAtomicRenderNode';
  }

  getBreakable() {
    return true;
  }

  getSize() {
    return 1;
  }
}
