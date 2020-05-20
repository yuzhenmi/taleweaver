import { DEFAULT_FONT, IFont, IFontOptional, ITextMeasurement, ITextService } from './service';

export class TextServiceStub implements ITextService {
    measure(text: string, font: IFont): ITextMeasurement {
        return { width: 10, height: 10 };
    }
    trim(text: string): string {
        return text;
    }
    breakIntoWords(text: string): string[] {
        return text.split(' ');
    }
    applyDefaultFont(font: IFontOptional): IFont {
        return DEFAULT_FONT;
    }
}
