import { IViewNode, IViewNodeType, ViewNode } from './node';

export interface IViewPage<TStyle> extends IViewNode<TStyle> {
    readonly domContentContainer: HTMLElement;
}

export abstract class ViewPage<TStyle> extends ViewNode<TStyle> implements IViewPage<TStyle> {
    abstract get domContentContainer(): HTMLElement;

    get type(): IViewNodeType {
        return 'page';
    }

    get root() {
        return false;
    }

    get leaf() {
        return false;
    }
}
