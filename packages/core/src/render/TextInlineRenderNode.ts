import Editor from '../Editor';
import Text, { TextStyle } from '../model/TextModelNode';
import generateID from '../utils/generateID';
import InlineRenderNode from './InlineRenderNode';
import TextAtomicRenderNode from './TextAtomicRenderNode';
import breakTextToWords from './utils/breakTextToWords';

export default class TextInlineRenderNode extends InlineRenderNode {
  protected textStyle?: TextStyle;

  constructor(editor: Editor, id: string) {
    super(editor, id);
  }

  getType(): string {
    return 'TextInlineRenderNode';
  }

  onModelUpdated(element: Text) {
    const textConfig = this.editor.getConfig().getTextConfig();
    const defaultTextStyle = textConfig.getDefaultStyle();
    const attributes = element.getAttributes();
    const textStyle = {
      weight: attributes.weight || defaultTextStyle.weight,
      size: attributes.size || defaultTextStyle.size,
      color: attributes.color || defaultTextStyle.color,
      font: attributes.font || defaultTextStyle.font,
      letterSpacing: attributes.letterSpacing || defaultTextStyle.letterSpacing,
      italic: attributes.italic || defaultTextStyle.italic,
      underline: attributes.underline || defaultTextStyle.underline,
      strikethrough: attributes.strikethrough || defaultTextStyle.strikethrough,
    };
    this.setTextStyle(textStyle);
    super.onModelUpdated(element);
    const words = breakTextToWords(element.getContent());
    let offset = 0;
    words.forEach(word => {
      let atomOffset = -1;
      for (let n = offset, nn = this.children.length; n < nn; n++) {
        const child = this.children[n] as TextAtomicRenderNode;
        if (child.getContent() === word.text && child.getBreakable() === word.breakable) {
          atomOffset = n;
          break;
        }
      }
      if (atomOffset < 0) {
        const atomicRenderNode = new TextAtomicRenderNode(
          this.editor,
          `${element.getID()}-${generateID()}`,
          word.text,
          word.breakable,
          textStyle,
        );
        atomicRenderNode.bumpVersion();
        this.insertChild(atomicRenderNode, offset);
      } else {
        for (let n = offset; n < atomOffset; n++) {
          this.deleteChild(this.children[offset]);
        }
      }
      offset++;
    });
    for (let n = offset, nn = this.children.length; n < nn; n++) {
      this.deleteChild(this.children[offset]);
    }
    if (this.children.length === 0) {
      const atomicRenderNode = new TextAtomicRenderNode(
        this.editor,
        `${element.getID()}-${generateID()}`,
        '',
        true,
        textStyle,
      );
      atomicRenderNode.bumpVersion();
      this.insertChild(atomicRenderNode);
    }
  }

  getTextStyle() {
    if (!this.textStyle) {
      throw new Error('Text render node has not been initialized with style.');
    }
    return this.textStyle;
  }

  setTextStyle(textStyle: TextStyle) {
    this.textStyle = textStyle;
  }
}
