import { IComponentService } from '../component/service';
import { EventEmitter, IEventEmitter } from '../event/emitter';
import { IEventListener, IOnEvent } from '../event/listener';
import { ILayoutService } from '../layout/service';
import { IDidUpdateLayoutStateEvent } from '../layout/state';
import { IDocViewNode } from './doc-node';
import { IViewNode } from './node';
import { ViewTreeBuilder } from './tree-builder';

export interface IDidUpdateViewStateEvent {
    readonly node: IViewNode;
}

export interface IViewState {
    onDidUpdateViewState: IOnEvent<IDidUpdateViewStateEvent>;
    getDocNode(): IDocViewNode;
    attach(domContainer: HTMLElement): void;
}

export class ViewState implements IViewState {
    protected attached = false;
    protected docNode: IDocViewNode;
    protected didUpdateViewStateEventEmitter: IEventEmitter<IDidUpdateViewStateEvent> = new EventEmitter();

    constructor(
        protected instanceId: string,
        protected componentService: IComponentService,
        protected layoutService: ILayoutService,
    ) {
        const docLayoutNode = layoutService.getDocNode();
        const treeBuilder = new ViewTreeBuilder(this.instanceId, componentService);
        this.docNode = treeBuilder.buildTree(docLayoutNode) as IDocViewNode;
        layoutService.onDidUpdateLayoutState(this.handleDidUpdateLayoutStateEvent);
    }

    onDidUpdateViewState(listener: IEventListener<IDidUpdateViewStateEvent>) {
        this.didUpdateViewStateEventEmitter.on(listener);
    }

    getDocNode() {
        return this.docNode;
    }

    attach(domContainer: HTMLElement) {
        if (this.attached) {
            throw new Error('View is already attached to the DOM.');
        }
        this.docNode.attach(domContainer);
        this.attached = true;
    }

    protected handleDidUpdateLayoutStateEvent = (event: IDidUpdateLayoutStateEvent) => {
        const treeBuilder = new ViewTreeBuilder(this.instanceId, this.componentService);
        const updatedNode = treeBuilder.buildTree(event.node);
        const node = this.docNode.findDescendant(event.node.getId()) as IViewNode;
        if (!node) {
            throw new Error(`Layout node ${event.node.getId()} is not found.`);
        }
        node.onDidUpdate(updatedNode);
        this.didUpdateViewStateEventEmitter.emit({ node });
    };
}
