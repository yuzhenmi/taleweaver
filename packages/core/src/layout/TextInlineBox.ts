import InlineBox from './InlineBox';

export default class TextInlineBox extends InlineBox {

  getType(): string {
    return 'TextInlineBox';
  }

  splitAt(offset: number): InlineBox {
    if (offset > this.children.length) {
      throw new Error(`Error cleaving TextInlineBox, offset ${offset} is out of range.`);
    }
    const childrenCut = this.children.splice(offset);
    const newTextInlineBox = new TextInlineBox(this.renderNodeID);
    childrenCut.forEach((child, childOffset) => {
      newTextInlineBox.insertChild(child, childOffset);
    });
    this.width = undefined;
    this.height = undefined;
    this.selectableSize = undefined;
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
    this.height = undefined;
    this.selectableSize = undefined;
  }
}
