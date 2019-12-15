import { IComponentService } from 'tw/component/service';
import { IEventListener } from 'tw/event/listener';
import { IDocLayoutNode } from 'tw/layout/doc-node';
import { ILayoutPosition } from 'tw/layout/node';
import { IDidUpdateLayoutStateEvent, ILayoutState, LayoutState } from 'tw/layout/state';
import { IRenderService } from 'tw/render/service';
import { IService } from 'tw/service/service';

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
