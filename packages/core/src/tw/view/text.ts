import { IViewNode, IViewNodeType, ViewNode } from './node';

export interface IViewText<TStyle> extends IViewNode<TStyle> {}

export abstract class ViewText<TStyle> extends ViewNode<TStyle> implements IViewText<TStyle> {
    constructor(componentId: string | null, renderId: string | null, layoutId: string, text: string, style: TStyle) {
        super(componentId, renderId, layoutId, text, style, []);
    }

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
