import { IDOMService } from '../dom/service';
import { IViewNode, IViewNodeType, ViewNode } from './node';

export interface IViewDoc<TStyle> extends IViewNode<TStyle> {}

export abstract class ViewDoc<TStyle> extends ViewNode<TStyle> implements IViewDoc<TStyle> {
    protected attached = false;

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
        return 'doc';
    }

    get root() {
        return true;
    }

    get leaf() {
        return false;
    }
}
