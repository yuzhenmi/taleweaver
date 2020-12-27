import { IDOMService } from '../dom/service';
import { EventEmitter } from '../event/emitter';
import { IEventListener, IOnEvent } from '../event/listener';
import { ILayoutService } from '../layout/service';
import { IDocViewNode } from './node';
import { ViewTreeManager } from './tree-manager';

export interface IDidUpdateViewStateEvent {}

export interface IViewState {
    readonly doc: IDocViewNode;
    readonly domContainer: HTMLElement | null;

    attach(domContainer: HTMLElement): void;
    onDidUpdate: IOnEvent<IDidUpdateViewStateEvent>;
}

export class ViewState implements IViewState {
    protected didUpdateEventEmitter = new EventEmitter<IDidUpdateViewStateEvent>();
    readonly doc: IDocViewNode;

    protected treeManager: ViewTreeManager;
    protected internalDOMContainer: HTMLElement | null = null;

    constructor(
        protected instanceId: string,
        protected layoutService: ILayoutService,
        protected domService: IDOMService,
    ) {
        this.treeManager = new ViewTreeManager(domService);
        this.doc = this.treeManager.syncWithLayoutTree(layoutService.getDoc());
        layoutService.onDidUpdateLayoutState(this.handleDidUpdateLayoutState);
    }

    get domContainer() {
        return this.internalDOMContainer;
    }

    attach(domContainer: HTMLElement) {
        this.internalDOMContainer = domContainer;
        domContainer.innerHTML = '';
        domContainer.appendChild(this.doc.domContainer);
    }

    onDidUpdate(listener: IEventListener<IDidUpdateViewStateEvent>) {
        return this.didUpdateEventEmitter.on(listener);
    }

    handleDidUpdateLayoutState = (event: IDidUpdateViewStateEvent) => {
        this.treeManager.syncWithLayoutTree(this.layoutService.getDoc());
        this.didUpdateEventEmitter.emit({});
    };
}
