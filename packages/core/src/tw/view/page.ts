import { IViewNode, IViewNodeType, ViewNode } from './node';

export interface IViewPage<TStyle> extends IViewNode<TStyle> {}

export abstract class ViewPage<TStyle> extends ViewNode<TStyle> implements IViewPage<TStyle> {
    constructor(componentId: string | null, readonly layoutId: string) {
        super(componentId, null, layoutId);
    }

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
