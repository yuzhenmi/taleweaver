import { IServiceRegistry } from '../service/registry';
import { IViewNode } from '../view/node';
import { IViewPage } from '../view/page';

export interface IPageComponent {
    readonly id: string;

    buildViewNode(
        domContainer: HTMLElement,
        layoutId: string,
        children: IViewNode<any>[],
        width: number,
        height: number,
        paddingTop: number,
        paddingBottom: number,
        paddingLeft: number,
        paddingRight: number,
    ): IViewPage;
}

export abstract class PageComponent {
    abstract buildViewNode(
        domContainer: HTMLElement,
        layoutId: string,
        children: IViewNode<any>[],
        width: number,
        height: number,
        paddingTop: number,
        paddingBottom: number,
        paddingLeft: number,
        paddingRight: number,
    ): IViewPage;

    constructor(readonly id: string, protected serviceRegistry: IServiceRegistry) {}
}
