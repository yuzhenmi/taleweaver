import { IDOMService } from '../dom/service';

export interface IFont {
    weight: number;
    size: number;
    family: string;
    letterSpacing: number;
    underline: boolean;
    italic: boolean;
    strikethrough: boolean;
    color: string;
}

export interface ITextMeasurement {
    width: number;
    height: number;
}

export const DEFAULT_FONT: IFont = {
    weight: 400,
    size: 16,
    family: 'sans-serif',
    letterSpacing: 0,
    underline: false,
    italic: false,
    strikethrough: false,
    color: 'black',
};

export const BREAKABLE_CHARS = [' ', '\n', '\t'];

export interface ITextService {
    measure(text: string, font: IFont): ITextMeasurement;
    breakIntoWords(text: string): Array<{ text: string; whitespaceSize: number }>;
    applyDefaultFont(font: Partial<IFont>): IFont;
}

export class TextService implements ITextService {
    protected $canvas: HTMLCanvasElement;

    constructor(domService: IDOMService) {
        this.$canvas = domService.createElement('canvas');
    }

    measure(text: string, font: IFont) {
        const fontWithDefault = this.applyDefaultFont(font);
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

    breakIntoWords(text: string) {
        const words: Array<{ text: string; whitespaceSize: number }> = [];
        let word = '';
        for (let n = 0, nn = text.length; n < nn; n++) {
            const char = text[n];
            word += char;
            if (BREAKABLE_CHARS.includes(char)) {
                words.push({
                    text: word,
                    whitespaceSize: 1,
                });
                word = '';
            }
        }
        if (word.length > 0) {
            words.push({
                text: word,
                whitespaceSize: 0,
            });
        }
        return words;
    }

    applyDefaultFont(font: Partial<IFont>): IFont {
        const fontConfigWithDefault: any = {};
        for (const key in DEFAULT_FONT) {
            if (key in font && (font as any)[key] !== undefined) {
                fontConfigWithDefault[key] = (font as any)[key];
            } else {
                fontConfigWithDefault[key] = (DEFAULT_FONT as any)[key];
            }
        }
        return fontConfigWithDefault as IFont;
    }

    protected fixFontFamily(fontFamily: string) {
        if (fontFamily.indexOf(' ') >= 0) {
            return `'${fontFamily}'`;
        }
        return fontFamily;
    }
}
