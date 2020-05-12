import { IViewNode, IViewNodeType, ViewNode } from './node';

export interface IViewLine<TStyle> extends IViewNode<TStyle> {}

export abstract class ViewLine<TStyle> extends ViewNode<TStyle> implements IViewLine<TStyle> {
    get type(): IViewNodeType {
        return 'line';
    }

    get root() {
        return false;
    }

    get leaf() {
        return false;
    }
}
