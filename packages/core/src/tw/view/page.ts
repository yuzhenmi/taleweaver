import { IDOMService } from '../dom/service';
import { IViewNode, IViewNodeType, ViewNode } from './node';

export interface IViewPage extends IViewNode<null> {
    readonly domContentContainer: HTMLElement;
}

export abstract class ViewPage extends ViewNode<null> implements IViewPage {
    abstract readonly domContentContainer: HTMLElement;

    constructor(
        domContainer: HTMLElement,
        componentId: string | null,
        readonly layoutId: string,
        children: IViewNode<any>[],
        domService: IDOMService,
    ) {
        super(domContainer, componentId, null, layoutId, '', null, children, domService);
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
