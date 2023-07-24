import { TextStyle } from '../text/service';

export abstract class MarkType<TProps> {
    abstract getStyle(props: TProps): Partial<TextStyle>;

    constructor(readonly id: string) {}
}

export interface Mark {
    typeId: string;
    start: number;
    end: number;
    props: any;
}
