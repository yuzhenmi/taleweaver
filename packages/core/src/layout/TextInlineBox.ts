import InlineBox from './InlineBox';

export default class TextInlineBox extends InlineBox {

  getType(): string {
    return 'TextInlineBox';
  }

  cleaveAt(offset: number): InlineBox {
    if (offset > this.children.length) {
      throw new Error(`Error cleaving TextInlineBox, offset ${offset} is out of range.`);
    }
    const childrenCut = this.children.splice(offset);
    this.width = undefined;
    this.selectableSize = undefined;
    const newTextInlineBox = new TextInlineBox(this.renderNodeID);
    childrenCut.forEach((child, childOffset) => {
      newTextInlineBox.insertChild(child, childOffset);
    });
    return newTextInlineBox;
  }
}
