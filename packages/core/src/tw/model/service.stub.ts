import { EventEmitter, IEventEmitter } from '../event/emitter';
import { IEventListener } from '../event/listener';
import { IModelNode, IModelPosition } from './node';
import { IModelRoot } from './root';
import { IModelService } from './service';
import { IDidUpdateModelStateEvent } from './state';

export class ModelServiceStub implements IModelService {
    protected didUpdateModelStateEventEmitter: IEventEmitter<IDidUpdateModelStateEvent> = new EventEmitter();

    constructor(protected root: IModelRoot<any>) {}

    emitDidUpdateModelStateEvent(event: IDidUpdateModelStateEvent) {
        this.didUpdateModelStateEventEmitter.emit(event);
    }

    onDidUpdateModelState(listener: IEventListener<IDidUpdateModelStateEvent>) {
        return this.didUpdateModelStateEventEmitter.on(listener);
    }

    getRoot() {
        return this.root;
    }

    toDOM(from: number, to: number): HTMLElement {
        throw new Error('Not implemented.');
    }

    fromDOM(domNodes: HTMLElement[]): IModelNode<any>[] {
        throw new Error('Not implemented.');
    }

    resolvePosition(offset: number): IModelPosition {
        throw new Error('Not implemented.');
    }
}
