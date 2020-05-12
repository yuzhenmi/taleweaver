import { applyDefaultFont, IFont } from './font';

export interface ITextMeasurement {
    width: number;
    height: number;
}

export interface ITextMeasurer {
    measure(text: string, font: IFont): ITextMeasurement;
    measureTrimmed(text: string, font: IFont): ITextMeasurement;
}

export class TextMeasurer implements ITextMeasurer {
    protected $canvas: HTMLCanvasElement;

    constructor() {
        this.$canvas = document.createElement('canvas');
    }

    measure(text: string, font: IFont) {
        const fontWithDefault = applyDefaultFont(font);
        const ctx = this.$canvas.getContext('2d')!;
        const weight = fontWithDefault.weight;
        const size = fontWithDefault.size;
        const family = this.fixFontFamily(fontWithDefault.family);
        const letterSpacing = fontWithDefault.letterSpacing;
        ctx.font = `${weight} ${size}px ${family}`;
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

    measureTrimmed(text: string, font: IFont) {
        if (!this.testTrimmable(text)) {
            return this.measure(text, font);
        }
        return this.measure(text.substring(0, text.length - 1), font);
    }

    protected fixFontFamily(fontFamily: string) {
        if (fontFamily.indexOf(' ') >= 0) {
            return `'${fontFamily}'`;
        }
        return fontFamily;
    }

    protected testTrimmable(text: string) {
        return false;
    }
}
