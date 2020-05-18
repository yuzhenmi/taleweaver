import { applyDefaultFont, IFont } from '../render/font';

const BREAKABLE_CHARS = [' ', '\n', '\t'];

export interface ITextMeasurement {
    width: number;
    height: number;
}

export interface ITextService {
    measure(text: string, font: IFont): ITextMeasurement;
    trim(text: string): string;
    breakIntoWords(text: string): string[];
}

export class TextMeasurer implements ITextService {
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

    trim(text: string) {
        if (!this.testTrimmable(text)) {
            return text;
        }
        return text.substring(0, text.length - 1);
    }

    breakIntoWords(text: string) {
        const words: string[] = [];
        let word = '';
        for (let n = 0, nn = text.length; n < nn; n++) {
            const char = text[n];
            word += char;
            if (BREAKABLE_CHARS.includes(char)) {
                words.push(word);
                word = '';
            }
        }
        if (word.length > 0) {
            words.push(word);
        }
        return words;
    }

    protected fixFontFamily(fontFamily: string) {
        if (fontFamily.indexOf(' ') >= 0) {
            return `'${fontFamily}'`;
        }
        return fontFamily;
    }

    protected testTrimmable(text: string) {
        if (text.length === 0) {
            return false;
        }
        return BREAKABLE_CHARS.includes(text[text.length - 1]);
    }
}
