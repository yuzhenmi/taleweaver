import { IComponentService } from '../component/service';
import { EventEmitter, IEventEmitter } from '../event/emitter';
import { IEventListener, IOnEvent } from '../event/listener';
import { IRenderService } from '../render/service';
import { IDidUpdateRenderStateEvent } from '../render/state';
import { ILayoutBlock } from './block';
import { ILayoutDoc } from './doc';
import { LayoutFlower } from './flower';
import { ILayoutInline } from './inline';
import { ILayoutNode } from './node';
import { NodeJoiner } from './node-joiner';
import { LayoutTreeBuilder } from './tree-builder';
import { identifyLayoutNodeType } from './utility';

export interface IDidUpdateLayoutStateEvent {
    readonly node: ILayoutNode;
}

export interface ILayoutState {
    onDidUpdateLayoutState: IOnEvent<IDidUpdateLayoutStateEvent>;
    getDocNode(): ILayoutDoc;
}

export class LayoutState implements ILayoutState {
    protected docNode: ILayoutDoc;
    protected didUpdateLayoutStateEventEmitter: IEventEmitter<IDidUpdateLayoutStateEvent> = new EventEmitter();

    constructor(protected componentService: IComponentService, protected renderService: IRenderService) {
        const docRenderNode = renderService.getDocNode();
        const treeBuilder = new LayoutTreeBuilder(componentService);
        this.docNode = treeBuilder.buildTree(docRenderNode) as ILayoutDoc;
        const flower = new LayoutFlower();
        flower.flow(this.docNode);
        renderService.onDidUpdateRenderState(this.handleDidUpdateRenderStateEvent);
    }

    onDidUpdateLayoutState(listener: IEventListener<IDidUpdateLayoutStateEvent>) {
        return this.didUpdateLayoutStateEventEmitter.on(listener);
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
        switch (identifyLayoutNodeType(node)) {
            case 'Inline':
                this.deduplicateInlineNode(node as ILayoutInline);
                break;
            case 'Block':
                this.deduplicateBlockNode(node as ILayoutBlock);
                break;
        }
    }

    protected deduplicateInlineNode(node: ILayoutInline) {
        const joiner = new NodeJoiner();
        let nextNode: ILayoutInline | undefined;
        const lineNode = node.getParent()!;
        while (
            (nextNode = node.getNextSiblingAllowCrossParent() as ILayoutInline | undefined) &&
            nextNode.getId() === node.getId()
        ) {
            const nextLineNode = nextNode.getParent()!;
            joiner.join(lineNode, nextLineNode);
        }
    }

    protected deduplicateBlockNode(node: ILayoutBlock) {
        const joiner = new NodeJoiner();
        let nextNode: ILayoutBlock | undefined;
        const pageNode = node.getParent()!;
        while (
            (nextNode = node.getNextSiblingAllowCrossParent() as ILayoutBlock | undefined) &&
            nextNode.getId() === node.getId()
        ) {
            const nextPageNode = nextNode.getParent()!;
            joiner.join(pageNode, nextPageNode);
        }
    }
}
