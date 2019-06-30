import { TextStyle } from '../model/Text';
import TextInlineRenderNode from '../render/TextInlineRenderNode';
import InlineBox from './InlineBox';

export default class TextInlineBox extends InlineBox {
  protected textStyle?: TextStyle;

  getType() {
    return 'TextInlineBox';
  }

  splitAt(offset: number) {
    if (offset > this.children.length) {
      throw new Error(`Error cleaving TextInlineBox, offset ${offset} is out of range.`);
    }
    const childrenCut = this.children.splice(offset);
    const newTextInlineBox = new TextInlineBox(this.editor, this.renderNodeID);
    newTextInlineBox.setTextStyle(this.getTextStyle());
    childrenCut.forEach((child, childOffset) => {
      newTextInlineBox.insertChild(child, childOffset);
    });
    this.clearCache();
    return newTextInlineBox;
  }

  join(textInlineBox: TextInlineBox) {
    if (textInlineBox.getRenderNodeID() !== this.renderNodeID) {
      throw new Error('Cannot join inline boxes with different render node IDs.');
    }
    let childOffset = this.children.length;
    textInlineBox.getChildren().forEach(child => {
      this.insertChild(child, childOffset);
      childOffset++;
    });
    this.clearCache();
  }

  onRenderUpdated(renderNode: TextInlineRenderNode) {
    super.onRenderUpdated(renderNode);
    this.setTextStyle(renderNode.getTextStyle());
  }

  setTextStyle(textStyle: TextStyle) {
    this.textStyle = textStyle;
  }

  getTextStyle() {
    if (!this.textStyle) {
      throw new Error('Text render node has not been initialized with style.');
    }
    return this.textStyle;
  }
}
