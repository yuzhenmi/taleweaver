import { DOMService } from '../dom/service';

export interface TextStyle {
    weight: number;
    size: number;
    family: string;
    letterSpacing: number;
    underline: boolean;
    italic: boolean;
    strikethrough: boolean;
    color: string;
}

export interface TextMeasurement {
    width: number;
    height: number;
}

interface IWord {
    content: string;
    whitespaceSize: number;
}

const BREAKABLE_CHARS = [' ', '\n', '\t'];

export class TextService implements TextService {
    protected $canvas: HTMLCanvasElement;

    constructor(domService: DOMService) {
        this.$canvas = domService.createElement('canvas');
    }

    measure(text: string, style: TextStyle) {
        const ctx = this.$canvas.getContext('2d')!;
        const weight = style.weight;
        const size = style.size;
        const family = this.fixFontFamily(style.family);
        const letterSpacing = style.letterSpacing;
        ctx.font = `${weight} ${size}px ${family}`;
        const measurement = ctx.measureText(text);
        const width =
            letterSpacing === 0 || text.length <= 1
                ? measurement.width
                : measurement.width + text.length * letterSpacing;
        return {
            width,
            height: size,
        };
    }

    breakIntoWords(text: string) {
        const words: IWord[] = [];
        let content = '';
        for (let n = 0, nn = text.length; n < nn; n++) {
            const char = text[n];
            content += char;
            if (BREAKABLE_CHARS.includes(char)) {
                words.push({
                    content,
                    whitespaceSize: 1,
                });
                content = '';
            }
        }
        if (content.length > 0) {
            words.push({
                content,
                whitespaceSize: 0,
            });
        }
        return words;
    }

    protected fixFontFamily(fontFamily: string) {
        if (fontFamily.indexOf(' ') >= 0) {
            return `'${fontFamily}'`;
        }
        return fontFamily;
    }
}
