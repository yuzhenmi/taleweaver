import { IDOMService } from '../dom/service';
import { IViewNode, IViewNodeType, ViewNode } from './node';

export interface IViewAtom<TStyle> extends IViewNode<TStyle> {}

export abstract class ViewAtom<TStyle> extends ViewNode<TStyle> implements IViewAtom<TStyle> {
    constructor(
        domContainer: HTMLElement,
        componentId: string | null,
        renderId: string | null,
        layoutId: string,
        style: TStyle,
        domService: IDOMService,
    ) {
        super(domContainer, componentId, renderId, layoutId, '', style, [], domService);
    }

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
