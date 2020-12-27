import { ITextStyle } from '../text/service';

export interface IMarkType<TAttributes> {
    readonly id: string;
    getStyle(attributes: TAttributes): Partial<ITextStyle>;
}

export abstract class MarkType<TAttributes> {
    abstract getStyle(attributes: TAttributes): Partial<ITextStyle>;

    constructor(readonly id: string) {}
}

export interface IMark {
    readonly typeId: string;
    readonly start: number;
    readonly end: number;
    readonly attributes: any;
}
