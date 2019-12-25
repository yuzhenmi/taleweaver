import { IComponentService } from '../component/service';
import { IEventListener } from '../event/listener';
import { IRenderService } from '../render/service';
import { IService } from '../service/service';
import { IDocLayoutNode } from './doc-node';
import { ILayoutPosition } from './node';
import { IDidUpdateLayoutStateEvent, ILayoutState, LayoutState } from './state';

export interface ILayoutService extends IService {
    onDidUpdateLayoutState(listener: IEventListener<IDidUpdateLayoutStateEvent>): void;
    getDocNode(): IDocLayoutNode;
    resolvePosition(offset: number): ILayoutPosition;
}

export class LayoutService implements ILayoutService {
    protected state: ILayoutState;

    constructor(componentService: IComponentService, renderService: IRenderService) {
        this.state = new LayoutState(componentService, renderService);
    }

    onDidUpdateLayoutState(listener: IEventListener<IDidUpdateLayoutStateEvent>) {
        this.state.onDidUpdateLayoutState(listener);
    }

    getDocNode() {
        return this.state.getDocNode();
    }

    resolvePosition(offset: number) {
        return this.state.getDocNode().resolvePosition(offset);
    }
}
