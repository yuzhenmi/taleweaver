import Box from './Box';
import InlineBox from './InlineBox';

export default abstract class LineBox extends Box {
  protected inlineBoxes: InlineBox[];

  constructor() {
    super(0, 0);
    this.inlineBoxes = [];
  }

  insertInlineBox(inlineBox: InlineBox) {
    const inlineBoxWidth = inlineBox.getWidth();
    const inlineBoxHeight = inlineBox.getHeight();
    this.width += inlineBoxWidth;
    this.height = Math.max(this.height, inlineBoxHeight);
    this.inlineBoxes.push(inlineBox);
  }
}
