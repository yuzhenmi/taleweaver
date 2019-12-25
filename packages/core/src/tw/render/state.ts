import { IComponentService } from '../component/service';
import { EventEmitter, IEventEmitter } from '../event/emitter';
import { IEventListener, IOnEvent } from '../event/listener';
import { IModelService } from '../model/service';
import { IDidUpdateModelStateEvent } from '../model/state';
import { IDocRenderNode } from './doc-node';
import { IRenderNode } from './node';
import { RenderTreeBuilder } from './tree-builder';

export interface IDidUpdateRenderStateEvent {
    readonly node: IRenderNode;
}

export interface IRenderState {
    onDidUpdateRenderState: IOnEvent<IDidUpdateRenderStateEvent>;
    getDocNode(): IDocRenderNode;
}

export class RenderState implements IRenderState {
    protected docNode: IDocRenderNode;
    protected didUpdateRenderStateEventEmitter: IEventEmitter<IDidUpdateRenderStateEvent> = new EventEmitter();

    constructor(protected componentService: IComponentService, protected modelService: IModelService) {
        const docModelNode = modelService.getDocNode();
        const treeBuilder = new RenderTreeBuilder(componentService);
        this.docNode = treeBuilder.buildTree(docModelNode) as IDocRenderNode;
        modelService.onDidUpdateModelState(this.handleDidUpdateModelStateEvent);
    }

    onDidUpdateRenderState(listener: IEventListener<IDidUpdateRenderStateEvent>) {
        this.didUpdateRenderStateEventEmitter.on(listener);
    }

    getDocNode() {
        return this.docNode;
    }

    protected handleDidUpdateModelStateEvent = (event: IDidUpdateModelStateEvent) => {
        const treeBuilder = new RenderTreeBuilder(this.componentService);
        const updatedNode = treeBuilder.buildTree(event.node);
        const node = this.docNode.findDescendant(event.node.getId()) as IRenderNode;
        if (!node) {
            throw new Error(`Render node ${event.node.getId()} is not found.`);
        }
        node.onDidUpdate(updatedNode);
        this.didUpdateRenderStateEventEmitter.emit({ node });
    };
}
