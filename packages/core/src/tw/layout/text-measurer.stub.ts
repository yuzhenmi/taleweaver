import { ITextMeasurer, ITextStyle } from './text-measurer';

export class TextMeasurerStub implements ITextMeasurer {
    measure(text: string, textStyle: ITextStyle) {
        return {
            width: text.length * (1 + textStyle.letterSpacing),
            height: textStyle.size,
        };
    }
}
