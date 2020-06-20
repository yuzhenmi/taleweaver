import { EventEmitter } from '../event/emitter';
import { IEventListener, IOnEvent } from '../event/listener';
import { IRenderService } from '../render/service';
import { IDidUpdateRenderStateEvent } from '../render/state';
import { ITextService } from '../text/service';
import { ILayoutDoc } from './doc';
import { ILayoutEngine, LayoutEngine } from './engine';

export interface IDidUpdateLayoutStateEvent {}

export interface ILayoutState {
    onDidUpdateLayoutState: IOnEvent<IDidUpdateLayoutStateEvent>;
    doc: ILayoutDoc;
}

export class LayoutState implements ILayoutState {
    protected engine: ILayoutEngine;
    protected internalDoc: ILayoutDoc;
    protected didUpdateLayoutStateEventEmitter = new EventEmitter<IDidUpdateLayoutStateEvent>();

    constructor(protected renderService: IRenderService, protected textService: ITextService) {
        this.engine = new LayoutEngine(textService);
        this.internalDoc = this.engine.updateDoc(null, renderService.getDoc());
        renderService.onDidUpdateRenderState((event) => this.handleDidUpdateRenderStateEvent(event));
    }

    get doc() {
        return this.internalDoc;
    }

    onDidUpdateLayoutState(listener: IEventListener<IDidUpdateLayoutStateEvent>) {
        return this.didUpdateLayoutStateEventEmitter.on(listener);
    }

    protected handleDidUpdateRenderStateEvent(event: IDidUpdateRenderStateEvent) {
        this.update();
    }

    protected update() {
        const renderDoc = this.renderService.getDoc();
        this.internalDoc = this.engine.updateDoc(this.doc, renderDoc);
        this.didUpdateLayoutStateEventEmitter.emit({});
    }
}
