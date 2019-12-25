import { IComponentService } from '../component/service';
import { IEventListener } from '../event/listener';
import { ILayoutService } from '../layout/service';
import { IService } from '../service/service';
import { IDocViewNode } from './doc-node';
import { IDidUpdateViewStateEvent, IViewState, ViewState } from './state';

export interface IViewService extends IService {
    onDidUpdateViewState(listener: IEventListener<IDidUpdateViewStateEvent>): void;
    getDocNode(): IDocViewNode;
    attach(domContainer: HTMLElement): void;
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

    attach(domContainer: HTMLElement) {
        this.state.attach(domContainer);
    }
}
