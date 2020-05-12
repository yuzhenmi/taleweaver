import { IViewNode, IViewNodeType, ViewNode } from './node';

export interface IViewBlock<TStyle> extends IViewNode<TStyle> {}

export abstract class ViewBlock<TStyle> extends ViewNode<TStyle> implements IViewBlock<TStyle> {
    get type(): IViewNodeType {
        return 'block';
    }

    get root() {
        return false;
    }

    get leaf() {
        return false;
    }
}
