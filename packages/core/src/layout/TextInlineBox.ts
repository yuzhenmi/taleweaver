import InlineBox from './InlineBox';

export default class TextInlineBox extends InlineBox {

  getType() {
    return 'TextInlineBox';
  }

  splitAt(offset: number) {
    if (offset > this.children.length) {
      throw new Error(`Error cleaving TextInlineBox, offset ${offset} is out of range.`);
    }
    const childrenCut = this.children.splice(offset);
    const newTextInlineBox = new TextInlineBox(this.editor, this.renderNodeID);
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
}
