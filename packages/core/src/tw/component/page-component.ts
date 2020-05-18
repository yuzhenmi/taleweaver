import { IViewPage } from '../view/page';

export interface IPageComponent {
    readonly id: string;

    buildViewNode(renderId: string, layoutId: string): IViewPage<any>;
}

export abstract class PageComponent {
    abstract buildViewNode(layoutId: string): IViewPage<any>;

    constructor(readonly id: string) {}
}
