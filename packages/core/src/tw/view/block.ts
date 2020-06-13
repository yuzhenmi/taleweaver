import { IDOMService } from '../dom/service';
import { IViewNode, IViewNodeType, ViewNode } from './node';

export interface IViewBlock<TStyle> extends IViewNode<TStyle> {}

export abstract class ViewBlock<TStyle> extends ViewNode<TStyle> implements IViewBlock<TStyle> {
    constructor(
        domContainer: HTMLElement,
        componentId: string | null,
        renderId: string | null,
        layoutId: string,
        style: TStyle,
        children: IViewNode<any>[],
        domService: IDOMService,
    ) {
        super(domContainer, componentId, renderId, layoutId, '', style, children, domService);
    }

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
