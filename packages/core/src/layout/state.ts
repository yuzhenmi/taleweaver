import { EventEmitter } from '../event/emitter';
import { IEventListener, IOnEvent } from '../event/listener';
import { IRenderService } from '../render/service';
import { ITextService } from '../text/service';
import { IDocLayoutNode } from './node';
import { LayoutTreeManager } from './tree-manager';

export interface IDidUpdateLayoutStateEvent {}

export interface ILayoutState {
    readonly doc: IDocLayoutNode;

    onDidUpdate: IOnEvent<IDidUpdateLayoutStateEvent>;
}

export class LayoutState implements ILayoutState {
    protected didUpdateEventEmitter = new EventEmitter<IDidUpdateLayoutStateEvent>();
    protected treeManager: LayoutTreeManager;
    readonly doc: IDocLayoutNode;

    constructor(protected renderService: IRenderService, textService: ITextService) {
        this.treeManager = new LayoutTreeManager(textService);
        this.doc = this.treeManager.syncWithRenderTree(renderService.getDoc());
        renderService.onDidUpdateRenderState(this.handleDidUpdateRenderState);
    }

    onDidUpdate(listener: IEventListener<IDidUpdateLayoutStateEvent>) {
        return this.didUpdateEventEmitter.on(listener);
    }

    handleDidUpdateRenderState = (event: IDidUpdateLayoutStateEvent) => {
        this.treeManager.syncWithRenderTree(this.renderService.getDoc());
        this.didUpdateEventEmitter.emit({});
    };
}
