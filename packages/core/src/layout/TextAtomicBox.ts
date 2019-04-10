import AtomicBox from './AtomicBox';
import ViewportBoundingRect from './ViewportBoundingRect';
import measureText from './helpers/measureText';
import TextAtomicRenderNode from '../render/TextAtomicRenderNode';

const stubTextStyle = {
  fontFamily: 'Arial',
  fontSize: 18,
  fontWeight: 400,
  lineHeight: 36,
  letterSpacing: 0,
};

export default class TextAtomicBox extends AtomicBox {
  protected width?: number;
  protected widthWithoutTrailingWhitespace?: number;
  protected height?: number;
  protected content: string;

  constructor(renderNodeID: string) {
    super(renderNodeID);
    this.content = '';
  }

  getWidth(): number {
    if (this.width === undefined || this.height === undefined) {
      const measurement = measureText(this.content, stubTextStyle);
      this.width = measurement.width;
      this.height = measurement.height;
    }
    return this.width;
  }

  getWidthWithoutTrailingWhitespace(): number {
    if (this.widthWithoutTrailingWhitespace === undefined) {
      if (this.breakable) {
        const measurement = measureText(this.content.substring(0, this.content.length - 1), stubTextStyle);
        this.widthWithoutTrailingWhitespace = measurement.width;
      } else {
        this.widthWithoutTrailingWhitespace = this.getWidth();
      }
    }
    return this.widthWithoutTrailingWhitespace;
  }

  getHeight(): number {
    if (this.width === undefined || this.height === undefined) {
      const measurement = measureText(this.content, stubTextStyle);
      this.width = measurement.width;
      this.height = measurement.height;
    }
    return this.height;
  }

  getContent(): string {
    return this.content;
  }

  getSelectableSize(): number {
    return this.content.length;
  }

  onRenderUpdated(renderNode: TextAtomicRenderNode) {
    this.content = renderNode.getContent();
    this.breakable = renderNode.getBreakable();
    this.width = undefined;
    this.height = undefined;
  }

  resolveViewportPositionToSelectableOffset(x: number): number {
    let lastWidth = 0;
    for (let n = 0, nn = this.content.length; n < nn; n++) {
      const textMeasurement = measureText(this.content.substring(0, n), stubTextStyle);
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

  resolveSelectableOffsetRangeToViewportBoundingRects(from: number, to: number): ViewportBoundingRect[] {
    if (from === 0 && to === this.getSelectableSize()) {
      return [{
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        width: this.getWidth(),
        height: this.getHeight(),
      }];
    }
    const fromTextMeasurement = measureText(this.content.substring(0, from), stubTextStyle);
    const toTextMeasurement = measureText(this.content.substring(0, to), stubTextStyle);
    return [{
      left: fromTextMeasurement.width,
      right: this.getWidth() - toTextMeasurement.width,
      top: 0,
      bottom: 0,
      width: toTextMeasurement.width - fromTextMeasurement.width,
      height: this.getHeight(),
    }];
  }
}
