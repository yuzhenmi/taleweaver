import { IEventListener } from '../event/listener';
import { IRenderService } from '../render/service';
import { ITextService } from '../text/service';
import { ILayoutDoc } from './doc';
import { ILayoutPosition, IResolveBoundingBoxesResult } from './node';
import { IDidUpdateLayoutStateEvent, ILayoutState, LayoutState } from './state';

export interface ILayoutService {
    onDidUpdateLayoutState(listener: IEventListener<IDidUpdateLayoutStateEvent>): void;
    getDoc(): ILayoutDoc;
    resolvePosition(offset: number): ILayoutPosition;
    resolveBoundingBoxes(from: number, to: number): IResolveBoundingBoxesResult;
}

export class LayoutService implements ILayoutService {
    protected state: ILayoutState;

    constructor(renderService: IRenderService, textService: ITextService) {
        this.state = new LayoutState(renderService, textService);
    }

    onDidUpdateLayoutState(listener: IEventListener<IDidUpdateLayoutStateEvent>) {
        this.state.onDidUpdateLayoutState(listener);
    }

    getDoc() {
        return this.state.doc;
    }

    resolvePosition(offset: number) {
        return this.state.doc.resolvePosition(offset);
    }

    resolveBoundingBoxes(from: number, to: number) {
        return this.state.doc.resolveBoundingBoxes(from, to);
    }
}
