import { ComponentService } from '../component/service';
import { EventEmitter } from '../event/emitter';
import { EventListener } from '../event/listener';
import { MarkService } from '../mark/service';
import { ModelService } from '../model/service';
import { DocRenderNode } from './nodes/doc';
import { RenderTreeManager } from './tree-manager';

export interface DidUpdateRenderStateEvent {}

export class RenderState {
    protected didUpdateEventEmitter = new EventEmitter<DidUpdateRenderStateEvent>();
    protected treeManager: RenderTreeManager;
    readonly doc: DocRenderNode;

    constructor(
        protected modelService: ModelService,
        protected componentService: ComponentService,
        protected markService: MarkService,
    ) {
        this.treeManager = new RenderTreeManager(componentService, markService);
        this.doc = this.treeManager.updateFromModel(null, modelService.getDoc());
        modelService.onDidUpdateModelState(this.handleDidUpdateModelState);
    }

    onDidUpdate(listener: EventListener<DidUpdateRenderStateEvent>) {
        return this.didUpdateEventEmitter.on(listener);
    }

    handleDidUpdateModelState = (event: DidUpdateRenderStateEvent) => {
        this.treeManager.updateFromModel(this.doc, this.modelService.getDoc());
        this.didUpdateEventEmitter.emit({});
    };
}
