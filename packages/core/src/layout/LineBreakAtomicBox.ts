import TextAtomicRenderNode from '../render/TextAtomicRenderNode';
import AtomicBox from './AtomicBox';
import { DEFAULT_STYLE } from '../config/TextConfig';
import TextAtomicBox from './TextAtomicBox';
import measureText from './utils/measureText';

export default class LineBreakAtomicBox extends AtomicBox {
  protected width?: number;
  protected height?: number;

  getWidth() {
    if (this.width === undefined || this.height === undefined) {
      this.updateBoundingBox();
    }
    return this.width!;
  }

  getWidthWithoutTrailingWhitespace() {
    if (this.widthWithoutTrailingWhitespace === undefined) {
      this.widthWithoutTrailingWhitespace = 0;
    }
    return this.widthWithoutTrailingWhitespace;
  }

  getHeight() {
    if (this.width === undefined || this.height === undefined) {
      this.updateBoundingBox();
    }
    return this.height!;
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

  getSelectableSize() {
    return 1;
  }

  onRenderUpdated(renderNode: TextAtomicRenderNode) {
    this.breakable = renderNode.getBreakable();
    this.clearCache();
  }

  splitAtWidth(width: number): LineBreakAtomicBox {
    throw new Error('Cannot split line break atomic box.');
  }

  join(lineBreakAtomicBox: LineBreakAtomicBox) {
    throw new Error('Cannot join line break atomic boxes.');
  }

  resolveViewportPositionToSelectableOffset(x: number) {
    return 0;
  }

  resolveSelectableOffsetRangeToViewportBoundingRects(from: number, to: number) {
    if (from === to) {
      return [{
        left: 0,
        right: this.getWidth(),
        top: 0,
        bottom: 0,
        width: 0,
        height: this.getHeight(),
        paddingTop: 0,
        paddingBottom: 0,
        paddingLeft: 0,
        paddingRight: 0,
      }];
    }
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

  protected clearCache() {
    super.clearCache();
    this.width = undefined;
    this.height = undefined;
  }

  protected updateBoundingBox() {
    const previousSibling = this.getPreviousSibling();
    let textStyle = DEFAULT_STYLE;
    if (previousSibling) {
      if (previousSibling instanceof TextAtomicBox) {
        textStyle = previousSibling.getTextStyle();
      }
      const measurement = measureText(' ', textStyle);
      this.width = measurement.width;
      this.height = previousSibling.getHeight();
    } else {
      const measurement = measureText(' ', textStyle);
      this.width = measurement.width;
      this.height = measurement.height;
    }
  }
}
