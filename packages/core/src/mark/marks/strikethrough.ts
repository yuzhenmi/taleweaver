import { TextStyle } from '../../text/service';
import { MarkType } from '../mark';

export interface IStrikethroughAttributes {
    strikethrough: boolean;
}

export class Strikethrough extends MarkType<IStrikethroughAttributes> {
    getStyle(attributes: IStrikethroughAttributes): Partial<TextStyle> {
        return { strikethrough: attributes.strikethrough };
    }
}
