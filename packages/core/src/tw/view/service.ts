import { IComponentService } from 'tw/component/service';
import { IEventListener } from 'tw/event/listener';
import { ILayoutService } from 'tw/layout/service';
import { IService } from 'tw/service/service';
import { IDocViewNode } from 'tw/view/doc-node';
import { IDidUpdateViewStateEvent, IViewState, ViewState } from 'tw/view/state';

export interface IViewService extends IService {
    onDidUpdateViewState(listener: IEventListener<IDidUpdateViewStateEvent>): void;
    getDocNode(): IDocViewNode;
}

export class ViewService implements IViewService {
    protected state: IViewState;

    constructor(componentService: IComponentService, layoutService: ILayoutService) {
        this.state = new ViewState(componentService, layoutService);
    }

    onDidUpdateViewState(listener: IEventListener<IDidUpdateViewStateEvent>) {
        this.state.onDidUpdateViewState(listener);
    }

    getDocNode() {
        return this.state.getDocNode();
    }
}
