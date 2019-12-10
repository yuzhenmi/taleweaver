import { IComponentService } from 'tw/component/service';
import { EventEmitter, IEventEmitter } from 'tw/event/emitter';
import { IEventListener, IOnEvent } from 'tw/event/listener';
import { IDocLayoutNode } from 'tw/layout/doc-node';
import { LayoutFlower } from 'tw/layout/flower';
import { ILayoutNode } from 'tw/layout/node';
import { LayoutTreeBuilder } from 'tw/layout/tree-builder';
import { IRenderService } from 'tw/render/service';
import { IDidUpdateRenderStateEvent } from 'tw/render/state';

export interface IDidUpdateLayoutStateEvent {
    readonly node: ILayoutNode;
}

export interface ILayoutState {
    onDidUpdateLayoutState: IOnEvent<IDidUpdateLayoutStateEvent>;
    getDocNode(): IDocLayoutNode;
}

export class LayoutState implements ILayoutState {
    protected docNode: IDocLayoutNode;
    protected didUpdateLayoutStateEventEmitter: IEventEmitter<IDidUpdateLayoutStateEvent> = new EventEmitter();

    constructor(protected componentService: IComponentService, protected renderService: IRenderService) {
        const docRenderNode = renderService.getDocNode();
        const treeBuilder = new LayoutTreeBuilder(componentService);
        this.docNode = treeBuilder.buildTree(docRenderNode) as IDocLayoutNode;
        renderService.onDidUpdateRenderState(event => this.handleDidUpdateRenderStateEvent(event));
    }

    onDidUpdateLayoutState(listener: IEventListener<IDidUpdateLayoutStateEvent>) {
        this.didUpdateLayoutStateEventEmitter.on(listener);
    }

    getDocNode() {
        return this.docNode;
    }

    protected handleDidUpdateRenderStateEvent(event: IDidUpdateRenderStateEvent) {
        const treeBuilder = new LayoutTreeBuilder(this.componentService);
        const updatedNode = treeBuilder.buildTree(event.node);
        const node = this.docNode.findDescendant(event.node.getId()) as ILayoutNode;
        if (!node) {
            throw new Error(`Render node ${event.node.getId()} is not found.`);
        }
        this.deduplicateNode(node);
        node.onUpdated(updatedNode);
        const flower = new LayoutFlower();
        const flowedNode = flower.flow(node);
        this.didUpdateLayoutStateEventEmitter.emit({ node: flowedNode });
    }

    protected deduplicateNode(node: ILayoutNode) {
        if (node.isRoot()) {
            return;
        }
        let nextNode = node.getNextSiblingAllowCrossParent() as ILayoutNode;
        let nodeToDelete: ILayoutNode;
        while (nextNode && nextNode.getId() === node.getId()) {
            nodeToDelete = nextNode;
            nextNode = nextNode.getNextSiblingAllowCrossParent() as ILayoutNode;
            nodeToDelete.getParent()!.removeChild(nodeToDelete);
        }
    }
}
