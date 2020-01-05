import { IComponentService } from '../component/service';
import { EventEmitter, IEventEmitter } from '../event/emitter';
import { IEventListener, IOnEvent } from '../event/listener';
import { IRenderService } from '../render/service';
import { IDidUpdateRenderStateEvent } from '../render/state';
import { IDocLayoutNode } from './doc-node';
import { LayoutFlower } from './flower';
import { ILayoutNode } from './node';
import { NodeJoiner } from './node-joiner';
import { LayoutTreeBuilder } from './tree-builder';

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
        const flower = new LayoutFlower();
        flower.flow(this.docNode);
        renderService.onDidUpdateRenderState(this.handleDidUpdateRenderStateEvent);
    }

    onDidUpdateLayoutState(listener: IEventListener<IDidUpdateLayoutStateEvent>) {
        this.didUpdateLayoutStateEventEmitter.on(listener);
    }

    getDocNode() {
        return this.docNode;
    }

    protected handleDidUpdateRenderStateEvent = (event: IDidUpdateRenderStateEvent) => {
        const treeBuilder = new LayoutTreeBuilder(this.componentService);
        const updatedNode = treeBuilder.buildTree(event.node);
        const node = this.docNode.findDescendant(event.node.getId()) as ILayoutNode;
        if (!node) {
            throw new Error(`Render node ${event.node.getId()} is not found.`);
        }
        this.deduplicateNode(node);
        node.onDidUpdate(updatedNode);
        const flower = new LayoutFlower();
        const flowedNode = flower.flow(node);
        this.didUpdateLayoutStateEventEmitter.emit({ node: flowedNode });
    };

    protected deduplicateNode(node: ILayoutNode) {
        const joiner = new NodeJoiner();
        let nextNode: ILayoutNode | undefined;
        const lineNode = node.getParent()!;
        while (
            (nextNode = node.getNextSiblingAllowCrossParent() as ILayoutNode | undefined) &&
            nextNode.getId() === node.getId()
        ) {
            const nextLineNode = nextNode.getParent()!;
            joiner.join(lineNode, nextLineNode);
        }
    }
}
