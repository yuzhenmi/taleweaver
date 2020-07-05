import { IEventListener } from '../event/listener';
import { IModelPosition } from '../model/position';
import { IRenderService } from '../render/service';
import { ITextService } from '../text/service';
import { IResolvedBoundingBoxes } from './bounding-box';
import { ILayoutDoc } from './doc';
import { IResolvedPosition } from './position';
import { IDidUpdateLayoutStateEvent, ILayoutState, LayoutState } from './state';

export interface ILayoutService {
    onDidUpdateLayoutState(listener: IEventListener<IDidUpdateLayoutStateEvent>): void;
    getDoc(): ILayoutDoc;
    resolvePosition(position: IModelPosition): IResolvedPosition;
    resolveBoundingBoxes(from: IModelPosition, to: IModelPosition): IResolvedBoundingBoxes;
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

    resolvePosition(position: IModelPosition) {
        return this.state.doc.resolvePosition(position);
    }

    resolveBoundingBoxes(from: IModelPosition, to: IModelPosition) {
        return this.state.doc.resolveBoundingBoxes(from, to);
    }
}
