import { ITextMeasurer, ITextStyle } from './text';

export class TextMeasurerStub implements ITextMeasurer {
    measure(text: string, textStyle: ITextStyle) {
        return {
            width: text.length * (1 + textStyle.letterSpacing),
            height: textStyle.size,
        };
    }
}

export const DEFAULT_TEXT_STYLE = {
    weight: 400,
    size: 14,
    font: 'sans-serif',
    letterSpacing: 0,
    underline: false,
    italic: false,
    strikethrough: false,
    color: 'black',
};
