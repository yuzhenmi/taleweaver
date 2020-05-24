import { IViewNode } from '../view/node';
import { IViewPage } from '../view/page';

export interface IPageComponent {
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
    ): IViewPage<any>;
}

export abstract class PageComponent {
    abstract buildViewNode(
        layoutId: string,
        children: IViewNode<any>[],
        width: number,
        height: number,
        paddingTop: number,
        paddingBottom: number,
        paddingLeft: number,
        paddingRight: number,
    ): IViewPage<any>;

    constructor(readonly id: string) {}
}
