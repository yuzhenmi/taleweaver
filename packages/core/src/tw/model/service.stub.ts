import { EventEmitter, IEventEmitter } from '../event/emitter';
import { IEventListener } from '../event/listener';
import { IToken } from '../transform/token';
import { IModelNode, IModelPosition } from './node';
import { IModelRoot } from './root';
import { IModelService } from './service';
import { IDidTransformModelStateEvent } from './state';

export class ModelServiceStub implements IModelService {
    protected didTransformModelStateEventEmitter: IEventEmitter<IDidTransformModelStateEvent> = new EventEmitter();

    constructor(protected root: IModelRoot<any>) {}

    emitDidTransformModelStateEvent(event: IDidTransformModelStateEvent) {
        this.didTransformModelStateEventEmitter.emit(event);
    }

    onDidTransformModelState(listener: IEventListener<IDidTransformModelStateEvent>) {
        return this.didTransformModelStateEventEmitter.on(listener);
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

    parseTokens(tokens: IToken[]): IModelNode<any> {
        throw new Error('Not implemented.');
    }
}
