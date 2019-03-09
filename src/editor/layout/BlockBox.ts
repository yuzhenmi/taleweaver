import Box from './Box';
import LineBox from './LineBox';

export default abstract class BlockBox extends Box {
  protected lineBoxes: LineBox[];

  constructor() {
    super(0, 0);
    this.lineBoxes = [];
  }

  insertLineBox(lineBox: LineBox) {
    const lineBoxWidth = lineBox.getWidth();
    const lineBoxHeight = lineBox.getHeight();
    this.width += lineBoxWidth;
    this.height = Math.max(this.height, lineBoxHeight);
    this.lineBoxes.push(lineBox);
  }
}
