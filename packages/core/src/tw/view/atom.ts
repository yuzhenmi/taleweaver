import { IViewNode, IViewNodeType, ViewNode } from './node';

export interface IViewAtom<TStyle> extends IViewNode<TStyle> {}

export abstract class ViewAtom<TStyle> extends ViewNode<TStyle> implements IViewAtom<TStyle> {
    get type(): IViewNodeType {
        return 'atom';
    }

    get root() {
        return false;
    }

    get leaf() {
        return true;
    }
}
