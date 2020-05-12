import { IEventListener } from '../event/listener';
import { IRenderService } from '../render/service';
import { ILayoutDoc } from './doc';
import { ILayoutPosition } from './node';
import { IPageLayoutRect } from './rect';
import { IDidUpdateLayoutStateEvent, ILayoutState, LayoutState } from './state';

export interface ILayoutService {
    onDidUpdateLayoutState(listener: IEventListener<IDidUpdateLayoutStateEvent>): void;
    getDocNode(): ILayoutDoc;
    resolvePosition(offset: number): ILayoutPosition;
    resolvePageRects(from: number, to: number): IPageLayoutRect[];
}

export class LayoutService implements ILayoutService {
    protected state: ILayoutState;

    constructor(renderService: IRenderService) {
        this.state = new LayoutState(renderService);
    }

    onDidUpdateLayoutState(listener: IEventListener<IDidUpdateLayoutStateEvent>) {
        this.state.onDidUpdateLayoutState(listener);
    }

    getDocNode() {
        return this.state.doc;
    }

    resolvePosition(offset: number) {
        return this.state.doc.resolvePosition(offset);
    }

    resolvePageRects(from: number, to: number) {
        return this.state.doc.resolvePageRects(from, to);
    }
}
