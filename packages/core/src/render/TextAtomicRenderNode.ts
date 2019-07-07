import Editor from '../Editor';
import { TextStyle } from '../model/Text';
import AtomicRenderNode from './AtomicRenderNode';

export default class TextAtomicRenderNode extends AtomicRenderNode {
  protected content: string;
  protected breakable: boolean;
  protected textStyle: TextStyle;

  constructor(editor: Editor, id: string, content: string, breakable: boolean, textStyle: TextStyle) {
    super(editor, id);
    this.content = content;
    this.breakable = breakable;
    this.textStyle = textStyle;
  }

  getType() {
    return 'TextAtomicRenderNode';
  }

  getSize() {
    return this.content.length;
  }

  getContent() {
    return this.content;
  }

  getBreakable() {
    return this.breakable;
  }

  getTextStyle() {
    if (!this.textStyle) {
      throw new Error('Text render node has not been initialized with style.');
    }
    return this.textStyle;
  }
}
