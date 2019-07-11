import { TextStyle } from '../../model/TextModelNode';

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
    const weight = textStyle.weight!;
    const size = textStyle.size!;
    const font = textStyle.font!;
    const letterSpacing = textStyle.letterSpacing!;
    ctx.font = `${weight} ${size}px "${font}"`;
    const measurement = ctx.measureText(text);
    const width = letterSpacing === 0 || text.length <= 1 ?
      measurement.width :
      measurement.width + (text.length - 1) * letterSpacing;
    return {
      width,
      height: size,
    };
  }
}

const textMeasurer = new TextMeasurer();

export default function measureText(text: string, textStyle: TextStyle): Measurement {
  return textMeasurer.measure(text, textStyle);
}
