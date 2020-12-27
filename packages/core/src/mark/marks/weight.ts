import { ITextStyle } from '../../text/service';
import { MarkType } from '../mark';

export interface IWeightAttributes {
    weight: number;
}

export class Weight extends MarkType<IWeightAttributes> {
    getStyle(attributes: IWeightAttributes): Partial<ITextStyle> {
        return { weight: attributes.weight };
    }
}
