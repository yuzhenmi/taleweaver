import TextStyle from './TextStyle';

type Measurement = {
  width: number;
  height: number;
};

export class TextMeasurer {
  protected $canvas: HTMLCanvasElement;

  constructor() {
    this.$canvas = document.createElement('canvas');
  }

  measure(text: string, textStyle: TextStyle) {
    const ctx = this.$canvas.getContext('2d')!;
    ctx.font = `${textStyle.fontWeight} ${textStyle.fontSize}px "${textStyle.fontFamily}"`;
    const measurement = ctx.measureText(text);
    return {
      width: measurement.width,
      height: textStyle.fontSize,
    };
  }
}

const textMeasurer = new TextMeasurer();

export default function measureText(text: string, textStyle: TextStyle): Measurement {
  return textMeasurer.measure(text, textStyle);
}
