import { DOMService } from '../dom/service';
import { EventEmitter } from '../event/emitter';
import { EventListener, OnEvent } from '../event/listener';
import { LayoutService } from '../layout/service';
import { IDocViewNode } from './node';
import { ViewTreeManager } from './tree-manager';

export interface IDidUpdateViewStateEvent {}

export interface IViewState {
    readonly doc: IDocViewNode;
    readonly domContainer: HTMLElement | null;

    attach(domContainer: HTMLElement): void;
    onDidUpdate: OnEvent<IDidUpdateViewStateEvent>;
}

export class ViewState implements IViewState {
    protected didUpdateEventEmitter = new EventEmitter<IDidUpdateViewStateEvent>();
    readonly doc: IDocViewNode;

    protected treeManager: ViewTreeManager;
    protected internalDOMContainer: HTMLElement | null = null;

    constructor(
        protected instanceId: string,
        protected layoutService: LayoutService,
        protected domService: DOMService,
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

    onDidUpdate(listener: EventListener<IDidUpdateViewStateEvent>) {
        return this.didUpdateEventEmitter.on(listener);
    }

    handleDidUpdateLayoutState = (event: IDidUpdateViewStateEvent) => {
        this.treeManager.syncWithLayoutTree(this.layoutService.getDoc());
        this.didUpdateEventEmitter.emit({});
    };
}
