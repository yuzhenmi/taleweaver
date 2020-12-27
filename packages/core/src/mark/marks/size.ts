import { ITextStyle } from '../../text/service';
import { MarkType } from '../mark';

export interface ISizeAttributes {
    size: number;
}

export class Size extends MarkType<ISizeAttributes> {
    getStyle(attributes: ISizeAttributes): Partial<ITextStyle> {
        return { size: attributes.size };
    }
}
