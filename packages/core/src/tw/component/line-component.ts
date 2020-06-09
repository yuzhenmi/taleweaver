import { IViewLine } from '../view/line';
import { IViewNode } from '../view/node';

export interface ILineComponent {
    readonly id: string;

    buildViewNode(
        layoutId: string,
        children: IViewNode<any>[],
        width: number,
        height: number,
        paddingTop: number,
        paddingBottom: number,
        paddingLeft: number,
        paddingRight: number,
    ): IViewLine;
}

export abstract class LineComponent implements ILineComponent {
    abstract buildViewNode(
        layoutId: string,
        children: IViewNode<any>[],
        width: number,
        height: number,
        paddingTop: number,
        paddingBottom: number,
        paddingLeft: number,
        paddingRight: number,
    ): IViewLine;

    constructor(readonly id: string) {}
}
