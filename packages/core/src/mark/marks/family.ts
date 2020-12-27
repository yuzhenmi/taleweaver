import { ITextStyle } from '../../text/service';
import { MarkType } from '../mark';

export interface IFamilyAttributes {
    family: string;
}

export class Family extends MarkType<IFamilyAttributes> {
    getStyle(attributes: IFamilyAttributes): Partial<ITextStyle> {
        return { family: attributes.family };
    }
}
