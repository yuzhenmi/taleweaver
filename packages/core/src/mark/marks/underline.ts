import { ITextStyle } from '../../text/service';
import { MarkType } from '../mark';

export interface IUnderlineAttributes {
    underline: boolean;
}

export class Underline extends MarkType<IUnderlineAttributes> {
    getStyle(attributes: IUnderlineAttributes): Partial<ITextStyle> {
        return { underline: attributes.underline };
    }
}
