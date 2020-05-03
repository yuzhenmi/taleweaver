import { IComponentService } from '../component/service';
import { EventEmitter, IEventEmitter } from '../event/emitter';
import { IEventListener, IOnEvent } from '../event/listener';
import { IModelService } from '../model/service';
import { IDidUpdateModelStateEvent } from '../model/state';
import { IRenderDoc } from './doc';
import { IRenderNode } from './node';
import { RenderTreeBuilder } from './tree-builder';

export interface IDidUpdateRenderStateEvent {
    readonly node: IRenderNode<any>;
}

export interface IRenderState {
    onDidUpdateRenderState: IOnEvent<IDidUpdateRenderStateEvent>;
    readonly doc: IRenderDoc<any>;
}

export class RenderState implements IRenderState {
    readonly doc: IRenderDoc<any>;

    protected didUpdateRenderStateEventEmitter: IEventEmitter<IDidUpdateRenderStateEvent> = new EventEmitter();

    constructor(protected componentService: IComponentService, protected modelService: IModelService) {
        const modelRoot = modelService.getRoot();
        const treeBuilder = new RenderTreeBuilder(componentService);
        this.doc = treeBuilder.buildTree(modelRoot) as IRenderDoc<any>;
        modelService.onDidUpdateModelState(this.handleDidUpdateModelStateEvent);
    }

    onDidUpdateRenderState(listener: IEventListener<IDidUpdateRenderStateEvent>) {
        return this.didUpdateRenderStateEventEmitter.on(listener);
    }

    protected handleDidUpdateModelStateEvent = (event: IDidUpdateModelStateEvent) => {
        const treeBuilder = new RenderTreeBuilder(this.componentService);
        const updatedNode = treeBuilder.buildTree(event.node);
        const node = this.doc.findDescendant(event.node.id) as IRenderNode<any>;
        if (!node) {
            throw new Error(`Render node ${event.node.id} is not found.`);
        }
        node.apply(updatedNode);
        this.didUpdateRenderStateEventEmitter.emit({ node });
    };
}
