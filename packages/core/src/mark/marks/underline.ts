import { TextStyle } from '../../text/service';
import { MarkType } from '../mark';

export interface IUnderlineAttributes {
    underline: boolean;
}

export class Underline extends MarkType<IUnderlineAttributes> {
    getStyle(attributes: IUnderlineAttributes): Partial<TextStyle> {
        return { underline: attributes.underline };
    }
}
