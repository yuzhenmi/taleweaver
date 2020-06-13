import { IDOMService } from '../dom/service';
import { IViewNode, IViewNodeType, ViewNode } from './node';

export interface IViewLine extends IViewNode<null> {}

export abstract class ViewLine extends ViewNode<null> implements IViewLine {
    constructor(
        componentId: string | null,
        readonly layoutId: string,
        children: IViewNode<any>[],
        domService: IDOMService,
    ) {
        super(componentId, null, layoutId, '', null, children, domService);
    }

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
