import { EventEmitter } from '../event/emitter';
import { EventListener } from '../event/listener';
import { RenderService } from '../render/service';
import { TextService } from '../text/service';
import { DocLayoutNode } from './nodes/doc';
import { LayoutTreeManager } from './tree-manager';

export interface DidUpdateLayoutStateEvent {}

export class LayoutState implements LayoutState {
    protected didUpdateEventEmitter = new EventEmitter<DidUpdateLayoutStateEvent>();
    protected treeManager: LayoutTreeManager;
    readonly doc: DocLayoutNode;

    constructor(protected renderService: RenderService, textService: TextService) {
        this.treeManager = new LayoutTreeManager(textService);
        this.doc = this.treeManager.syncWithRenderTree(null, renderService.getDoc());
        renderService.onDidUpdateRenderState(this.handleDidUpdateRenderState);
    }

    onDidUpdate(listener: EventListener<DidUpdateLayoutStateEvent>) {
        return this.didUpdateEventEmitter.on(listener);
    }

    handleDidUpdateRenderState = (event: DidUpdateLayoutStateEvent) => {
        this.treeManager.syncWithRenderTree(this.doc, this.renderService.getDoc());
        this.didUpdateEventEmitter.emit({});
    };
}
