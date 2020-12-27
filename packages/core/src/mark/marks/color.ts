import { ITextStyle } from '../../text/service';
import { MarkType } from '../mark';

export interface IColorAttributes {
    color: string;
}

export class Color extends MarkType<IColorAttributes> {
    getStyle(attributes: IColorAttributes): Partial<ITextStyle> {
        return { color: attributes.color };
    }
}
