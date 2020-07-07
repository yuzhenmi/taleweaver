import { IEventListener } from '../event/listener';
import { IRenderPosition } from '../render/position';
import { IRenderService } from '../render/service';
import { ITextService } from '../text/service';
import { IResolvedBoundingBoxes } from './bounding-box';
import { ILayoutDoc } from './doc';
import { IResolvedLayoutPosition } from './position';
import { IDidUpdateLayoutStateEvent, ILayoutState, LayoutState } from './state';

export interface ILayoutService {
    onDidUpdateLayoutState(listener: IEventListener<IDidUpdateLayoutStateEvent>): void;
    getDoc(): ILayoutDoc;
    resolvePosition(position: IRenderPosition): IResolvedLayoutPosition;
    resolveBoundingBoxes(from: IRenderPosition, to: IRenderPosition): IResolvedBoundingBoxes;
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

    resolvePosition(position: IRenderPosition) {
        return this.state.doc.resolvePosition(position);
    }

    resolveBoundingBoxes(from: IRenderPosition, to: IRenderPosition) {
        return this.state.doc.resolveBoundingBoxes(from, to);
    }
}
