import { TextStyle } from '../../text/service';
import { MarkType } from '../mark';

export interface IColorAttributes {
    color: string;
}

export class Color extends MarkType<IColorAttributes> {
    getStyle(attributes: IColorAttributes): Partial<TextStyle> {
        return { color: attributes.color };
    }
}
