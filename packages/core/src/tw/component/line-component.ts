import { IViewLine } from '../view/line';

export interface ILineComponent {
    readonly id: string;

    buildViewNode(layoutId: string): IViewLine<any>;
}

export abstract class LineComponent implements ILineComponent {
    abstract buildViewNode(layoutId: string): IViewLine<any>;

    constructor(readonly id: string) {}
}
