import AtomicBox from './AtomicBox';
import measureText from './utils/measureText';
import TextAtomicRenderNode from '../render/TextAtomicRenderNode';
import TextStyle from './utils/TextStyle';

export default class TextAtomicBox extends AtomicBox {
  protected width?: number;
  protected height?: number;
  protected content: string = '';
  protected textStyle: TextStyle = {
    fontFamily: 'sans-serif',
    fontSize: 18,
    fontWeight: 400,
    letterSpacing: 0,
  };

  getWidth() {
    if (this.width === undefined || this.height === undefined) {
      const measurement = measureText(this.content, this.textStyle);
      this.width = measurement.width;
      this.height = measurement.height;
    }
    return this.width;
  }

  getWidthWithoutTrailingWhitespace() {
    if (this.widthWithoutTrailingWhitespace === undefined) {
      if (this.breakable) {
        const measurement = measureText(this.content.substring(0, this.content.length - 1), this.textStyle);
        this.widthWithoutTrailingWhitespace = measurement.width;
      } else {
        this.widthWithoutTrailingWhitespace = this.getWidth();
      }
    }
    return this.widthWithoutTrailingWhitespace;
  }

  getHeight() {
    if (this.width === undefined || this.height === undefined) {
      const measurement = measureText(this.content, this.textStyle);
      this.width = measurement.width;
      this.height = measurement.height;
    }
    return this.height;
  }

  getPaddingTop() {
    return 0;
  }

  getPaddingBottom() {
    return 0;
  }

  getPaddingLeft() {
    return 0;
  }

  getPaddingRight() {
    return 0;
  }

  setContent(content: string) {
    this.content = content;
    this.clearCache();
  }

  getContent() {
    return this.content;
  }

  getSelectableSize() {
    return this.content.length;
  }

  onRenderUpdated(renderNode: TextAtomicRenderNode) {
    this.content = renderNode.getContent();
    this.breakable = renderNode.getBreakable();
    this.clearCache();
  }

  splitAtWidth(width: number) {
    // Use binary search to determine offset to split at
    let min = 0;
    let max = this.content.length;
    while (max - min > 1) {
      const offset = Math.floor((max + min) / 2);
      const substr = this.content.substring(0, offset);
      const subwidth = measureText(substr, this.textStyle).width;
      if (subwidth > width) {
        max = offset;
      } else {
        min = offset;
      }
    }
    const splitAt = min;
    const newTextAtomicBox = new TextAtomicBox(this.editor, this.renderNodeID);
    newTextAtomicBox.setContent(this.content.substring(splitAt));
    this.content = this.content.substring(0, splitAt);
    this.clearCache();
    return newTextAtomicBox;
  }

  join(textAtomicBox: TextAtomicBox) {
    if (textAtomicBox.getRenderNodeID() !== this.renderNodeID) {
      throw new Error('Cannot join atomic boxes with different render node IDs.');
    }
    this.content += textAtomicBox.getContent();
    this.clearCache();
  }

  resolveViewportPositionToSelectableOffset(x: number) {
    let lastWidth = 0;
    for (let n = 0, nn = this.content.length; n < nn; n++) {
      const textMeasurement = measureText(this.content.substring(0, n), this.textStyle);
      const width = textMeasurement.width;
      if (width < x) {
        lastWidth = width;
        continue;
      }
      if (x - lastWidth < width - x) {
        return n - 1;
      }
      return n;
    }
    const width = this.getWidth();
    if (x - lastWidth < width - x) {
      return this.content.length - 1;
    }
    return this.content.length;
  }

  resolveSelectableOffsetRangeToViewportBoundingRects(from: number, to: number) {
    if (from === 0 && to === this.getSelectableSize()) {
      return [{
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        width: this.getWidth(),
        height: this.getHeight(),
        paddingTop: 0,
        paddingBottom: 0,
        paddingLeft: 0,
        paddingRight: 0,
      }];
    }
    const fromTextMeasurement = measureText(this.content.substring(0, from), this.textStyle);
    const toTextMeasurement = measureText(this.content.substring(0, to), this.textStyle);
    const width = toTextMeasurement.width - fromTextMeasurement.width;
    const height = this.getHeight();
    const paddingTop = this.getPaddingTop();
    const paddingBottom = this.getPaddingBottom();
    const paddingLeft = this.getPaddingLeft();
    const paddingRight = this.getPaddingRight();
    const left = paddingLeft + fromTextMeasurement.width;
    const right = paddingRight + (this.getWidth() - toTextMeasurement.width);
    const top = paddingTop;
    const bottom = paddingBottom;
    return [{
      width,
      height,
      left,
      right,
      top,
      bottom,
      paddingTop: 0,
      paddingBottom: 0,
      paddingLeft: 0,
      paddingRight: 0,
    }];
  }

  protected clearCache() {
    super.clearCache();
    this.width = undefined;
    this.height = undefined;
  }
}
