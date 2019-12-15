import { IComponentService } from 'tw/component/service';
import { EventEmitter, IEventEmitter } from 'tw/event/emitter';
import { IEventListener, IOnEvent } from 'tw/event/listener';
import { ILayoutService } from 'tw/layout/service';
import { IDidUpdateLayoutStateEvent } from 'tw/layout/state';
import { IDocViewNode } from 'tw/view/doc-node';
import { IViewNode } from 'tw/view/node';
import { ViewTreeBuilder } from 'tw/view/tree-builder';

export interface IDidUpdateViewStateEvent {
    readonly node: IViewNode;
}

export interface IViewState {
    onDidUpdateViewState: IOnEvent<IDidUpdateViewStateEvent>;
    getDocNode(): IDocViewNode;
}

export class ViewState implements IViewState {
    protected docNode: IDocViewNode;
    protected didUpdateViewStateEventEmitter: IEventEmitter<IDidUpdateViewStateEvent> = new EventEmitter();

    constructor(protected componentService: IComponentService, protected layoutService: ILayoutService) {
        const docLayoutNode = layoutService.getDocNode();
        const treeBuilder = new ViewTreeBuilder(componentService);
        this.docNode = treeBuilder.buildTree(docLayoutNode) as IDocViewNode;
        layoutService.onDidUpdateLayoutState(event => this.handleDidUpdateLayoutStateEvent(event));
    }

    onDidUpdateViewState(listener: IEventListener<IDidUpdateViewStateEvent>) {
        this.didUpdateViewStateEventEmitter.on(listener);
    }

    getDocNode() {
        return this.docNode;
    }

    protected handleDidUpdateLayoutStateEvent(event: IDidUpdateLayoutStateEvent) {
        const treeBuilder = new ViewTreeBuilder(this.componentService);
        const updatedNode = treeBuilder.buildTree(event.node);
        const node = this.docNode.findDescendant(event.node.getId()) as IViewNode;
        if (!node) {
            throw new Error(`Layout node ${event.node.getId()} is not found.`);
        }
        node.onDidUpdate(updatedNode);
        this.didUpdateViewStateEventEmitter.emit({ node });
    }
}
