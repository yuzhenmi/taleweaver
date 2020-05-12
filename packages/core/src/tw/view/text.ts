import { IViewNode, IViewNodeType, ViewNode } from './node';

export interface IViewText<TStyle> extends IViewNode<TStyle> {}

export abstract class ViewText<TStyle> extends ViewNode<TStyle> implements IViewText<TStyle> {
    get type(): IViewNodeType {
        return 'text';
    }

    get root() {
        return false;
    }

    get leaf() {
        return true;
    }
}
