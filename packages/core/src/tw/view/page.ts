import { IDOMService } from '../dom/service';
import { IViewNode, IViewNodeType, ViewNode } from './node';

export interface IViewPage extends IViewNode<null> {}

export abstract class ViewPage extends ViewNode<null> implements IViewPage {
    constructor(
        componentId: string | null,
        readonly layoutId: string,
        children: IViewNode<any>[],
        domService: IDOMService,
    ) {
        super(componentId, null, layoutId, '', null, children, domService);
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
