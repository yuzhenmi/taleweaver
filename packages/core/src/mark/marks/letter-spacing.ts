import { ITextStyle } from '../../text/service';
import { MarkType } from '../mark';

export interface ILetterSpacingAttributes {
    letterSpacing: number;
}

export class LetterSpacing extends MarkType<ILetterSpacingAttributes> {
    getStyle(attributes: ILetterSpacingAttributes): Partial<ITextStyle> {
        return { letterSpacing: attributes.letterSpacing };
    }
}
