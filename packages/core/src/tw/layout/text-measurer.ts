export interface ITextMeasurement {
    width: number;
    height: number;
}

export interface ITextStyle {
    weight: number;
    size: number;
    font: string;
    letterSpacing: number;
}

export interface ITextMeasurer {
    measure(text: string, style: ITextStyle): ITextMeasurement;
}

export class TextMeasurer implements ITextMeasurer {
    protected $canvas: HTMLCanvasElement;

    constructor() {
        this.$canvas = document.createElement('canvas');
    }

    measure(text: string, textStyle: ITextStyle) {
        const ctx = this.$canvas.getContext('2d')!;
        const weight = textStyle.weight!;
        const size = textStyle.size!;
        const font = textStyle.font!;
        const letterSpacing = textStyle.letterSpacing!;
        ctx.font = `${weight} ${size}px "${font}"`;
        const measurement = ctx.measureText(text);
        const width =
            letterSpacing === 0 || text.length <= 1
                ? measurement.width
                : measurement.width + (text.length - 1) * letterSpacing;
        return {
            width,
            height: size,
        };
    }
}
