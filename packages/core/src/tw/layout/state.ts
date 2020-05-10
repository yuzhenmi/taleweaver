import { IComponentService } from '../component/service';
import { EventEmitter } from '../event/emitter';
import { IEventListener, IOnEvent } from '../event/listener';
import { IRenderService } from '../render/service';
import { IDidUpdateRenderStateEvent } from '../render/state';
import { ILayoutDoc, LayoutDoc } from './doc';
import { ILayoutEngine, LayoutEngine } from './engine';

export interface IDidUpdateLayoutStateEvent {}

export interface ILayoutState {
    onDidUpdateLayoutState: IOnEvent<IDidUpdateLayoutStateEvent>;
    doc: ILayoutDoc;
}

export class LayoutState implements ILayoutState {
    readonly doc: ILayoutDoc;

    protected layoutEngine: ILayoutEngine;
    protected didUpdateLayoutStateEventEmitter = new EventEmitter<IDidUpdateLayoutStateEvent>();

    constructor(protected componentService: IComponentService, protected renderService: IRenderService) {
        this.layoutEngine = new LayoutEngine(componentService);
        const renderDoc = renderService.getDoc();
        this.doc = new LayoutDoc(renderDoc.id);
        this.layoutEngine.updateDoc(this.doc, renderDoc);
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
        this.layoutEngine.updateDoc(this.doc, renderDoc);
        this.didUpdateLayoutStateEventEmitter.emit({});
    };
}
