import AtomicBox from './AtomicBox';
import ViewportBoundingRect from './ViewportBoundingRect';
import measureText from './helpers/measureText';

const stubTextStyle = {
  fontFamily: 'Arial',
  fontSize: 18,
  fontWeight: 400,
  lineHeight: 36,
  letterSpacing: 0,
};

export default class TextAtomicBox extends AtomicBox {
  protected width: number;
  protected height: number;
  protected selectableSize?: number;
  protected content: string;

  constructor(renderNodeID: string, breakable: boolean, content: string) {
    super(renderNodeID, breakable);
    const textMeasurement = measureText(content, stubTextStyle);
    this.width = textMeasurement.width;
    this.height = textMeasurement.height;
    this.content = content;
  }

  getWidth(): number {
    return this.width;
  }

  getHeight(): number {
    return this.height;
  }

  getSelectableSize(): number {
    return this.content.length;
  }

  getContent(): string {
    return this.content;
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
    return this.content.length - 1;
  }

  resolveSelectableOffsetRangeToViewportBoundingRects(from: number, to: number): ViewportBoundingRect[] {
    if (from === 0 && to === this.selectableSize) {
      return [{
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        width: this.width,
        height: this.height,
      }];
    }
    const fromTextMeasurement = measureText(this.content.substring(0, from), stubTextStyle);
    const toTextMeasurement = measureText(this.content.substring(0, to), stubTextStyle);
    return [{
      left: fromTextMeasurement.width,
      right: this.width - toTextMeasurement.width,
      top: 0,
      bottom: 0,
      width: toTextMeasurement.width - fromTextMeasurement.width,
      height: this.height,
    }];
  }
}
