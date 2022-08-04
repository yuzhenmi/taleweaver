import { TextStyle } from '../text/service';

export abstract class MarkType<TAttributes> {
    abstract getStyle(attributes: TAttributes): Partial<TextStyle>;

    constructor(readonly id: string) {}
}

export interface Mark {
    typeId: string;
    start: number;
    end: number;
    attributes: any;
}
