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
    readonly doc: ILayoutDoc;

    protected engine: ILayoutEngine;
    protected didUpdateLayoutStateEventEmitter = new EventEmitter<IDidUpdateLayoutStateEvent>();

    constructor(protected renderService: IRenderService, protected textService: ITextService) {
        this.engine = new LayoutEngine(textService);
        this.doc = this.engine.buildDoc(renderService.getDoc());
        renderService.onDidUpdateRenderState(this.handleDidUpdateRenderStateEvent);
    }

    onDidUpdateLayoutState(listener: IEventListener<IDidUpdateLayoutStateEvent>) {
        return this.didUpdateLayoutStateEventEmitter.on(listener);
    }

    getDocNode() {
        return this.doc;
    }

    protected handleDidUpdateRenderStateEvent = (event: IDidUpdateRenderStateEvent) => {
        const renderDoc = this.renderService.getDoc();
        this.engine.updateDoc(this.doc, renderDoc);
        this.didUpdateLayoutStateEventEmitter.emit({});
    };
}
