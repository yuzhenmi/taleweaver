import { ITextStyle } from '../../text/service';
import { MarkType } from '../mark';

export interface IItalicAttributes {
    italic: boolean;
}

export class Italic extends MarkType<IItalicAttributes> {
    getStyle(attributes: IItalicAttributes): Partial<ITextStyle> {
        return { italic: attributes.italic };
    }
}
