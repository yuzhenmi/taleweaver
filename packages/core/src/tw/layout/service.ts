import { IComponentService } from '../component/service';
import { IEventListener } from '../event/listener';
import { IRenderService } from '../render/service';
import { IDocLayoutNode } from './doc-node';
import { ILayoutPosition } from './node';
import { IPageLayoutRect } from './rect';
import { IDidUpdateLayoutStateEvent, ILayoutState, LayoutState } from './state';

export interface ILayoutService {
    onDidUpdateLayoutState(listener: IEventListener<IDidUpdateLayoutStateEvent>): void;
    getDocNode(): IDocLayoutNode;
    resolvePosition(offset: number): ILayoutPosition;
    resolvePageRects(from: number, to: number): IPageLayoutRect[];
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

    resolvePageRects(from: number, to: number) {
        return this.state.getDocNode().resolvePageRects(from, to);
    }
}
