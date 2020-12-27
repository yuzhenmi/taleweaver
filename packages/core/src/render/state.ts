import { IComponentService } from '../component/service';
import { EventEmitter } from '../event/emitter';
import { IEventListener, IOnEvent } from '../event/listener';
import { IMarkService } from '../mark/service';
import { IModelService } from '../model/service';
import { IDocRenderNode } from './node';
import { RenderTreeManager } from './tree-manager';

export interface IDidUpdateRenderStateEvent {}

export interface IRenderState {
    readonly doc: IDocRenderNode;

    onDidUpdate: IOnEvent<IDidUpdateRenderStateEvent>;
}

export class RenderState implements IRenderState {
    protected didUpdateEventEmitter = new EventEmitter<
        IDidUpdateRenderStateEvent
    >();
    protected treeManager: RenderTreeManager;
    readonly doc: IDocRenderNode;

    constructor(
        protected modelService: IModelService,
        protected componentService: IComponentService,
        protected markService: IMarkService,
    ) {
        this.treeManager = new RenderTreeManager(componentService, markService);
        this.doc = this.treeManager.syncWithModelTree(modelService.getDoc());
        modelService.onDidUpdateModelState(this.handleDidUpdateModelState);
    }

    onDidUpdate(listener: IEventListener<IDidUpdateRenderStateEvent>) {
        return this.didUpdateEventEmitter.on(listener);
    }

    handleDidUpdateModelState = (event: IDidUpdateRenderStateEvent) => {
        this.treeManager.syncWithModelTree(this.modelService.getDoc());
        this.didUpdateEventEmitter.emit({});
    };
}
