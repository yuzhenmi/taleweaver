import AtomicRenderNode from './AtomicRenderNode';
import Editor from '../Editor';

export default class TextAtomicRenderNode extends AtomicRenderNode {
  protected content: string;
  protected breakable: boolean;

  constructor(editor: Editor, id: string, content: string, breakable: boolean) {
    super(editor, id);
    this.content = content;
    this.breakable = breakable;
  }

  getType() {
    return 'TextAtomicRenderNode';
  }

  getSelectableSize() {
    return this.content.length;
  }

  getContent() {
    return this.content;
  }

  getBreakable() {
    return this.breakable;
  }
}
