import { IDOMService } from '../dom/service';
import { IViewNode, IViewNodeType, ViewNode } from './node';

export interface IViewText<TStyle> extends IViewNode<TStyle> {}

export abstract class ViewText<TStyle> extends ViewNode<TStyle> implements IViewText<TStyle> {
    constructor(
        domContainer: HTMLElement,
        componentId: string | null,
        renderId: string | null,
        layoutId: string,
        text: string,
        style: TStyle,
        domService: IDOMService,
    ) {
        super(domContainer, componentId, renderId, layoutId, text, style, [], domService);
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
