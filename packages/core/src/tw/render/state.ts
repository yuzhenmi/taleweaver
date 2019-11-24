import { IComponentService } from 'tw/component/service';
import { EventEmitter, IEventEmitter } from 'tw/event/emitter';
import { IEventListener, IOnEvent } from 'tw/event/listener';
import { IModelService } from 'tw/model/service';
import { IDidUpdateModelStateEvent } from 'tw/model/state';
import { IDocRenderNode } from 'tw/render/doc-node';
import { IRenderNode } from 'tw/render/node';
import { RenderTreeBuilder } from 'tw/render/tree-builder';

export interface IDidUpdateRenderStateEvent {
    readonly updatedNode: IRenderNode;
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
        modelService.onDidUpdateModelState(event => this.handleDidUpdateModelStateEvent(event));
    }

    onDidUpdateRenderState(listener: IEventListener<IDidUpdateRenderStateEvent>) {
        this.didUpdateRenderStateEventEmitter.on(listener);
    }

    getDocNode() {
        return this.docNode;
    }

    protected handleDidUpdateModelStateEvent(event: IDidUpdateModelStateEvent) {
        const treeBuilder = new RenderTreeBuilder(this.componentService);
        const updatedNode = treeBuilder.buildTree(event.updatedNode);
        const originalNode = this.docNode.findDescendant(event.updatedNode.getId());
        if (!originalNode) {
            throw new Error(`Render node ${event.updatedNode.getId()} is not found.`);
        }
        const parentNode = originalNode.getParent()!;
        parentNode.replaceChild(updatedNode);
        this.clearCacheForNodeAncestors(updatedNode);
        this.didUpdateRenderStateEventEmitter.emit({
            updatedNode,
        });
    }

    protected clearCacheForNodeAncestors(node: IRenderNode) {
        let currentNode = node;
        while (true) {
            currentNode.clearCache();
            if (currentNode.isRoot()) {
                break;
            }
            currentNode = currentNode.getParent()!;
        }
    }
}
