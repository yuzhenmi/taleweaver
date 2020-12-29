import { EventEmitter } from '../event/emitter';
import { IEventListener, IOnEvent } from '../event/listener';
import { IDocModelNode } from './node';
import { IOperation, IOperationResult } from './operation/operation';

export interface IDidUpdateModelStateEvent {
    operationResult: IOperationResult;
}

export interface IModelState {
    readonly doc: IDocModelNode;

    applyOperation(operation: IOperation): IOperationResult;
    onDidUpdate: IOnEvent<IDidUpdateModelStateEvent>;
}

export class ModelState implements IModelState {
    protected didUpdateEventEmitter = new EventEmitter<IDidUpdateModelStateEvent>();

    constructor(readonly doc: IDocModelNode) {}

    applyOperation(operation: IOperation) {
        const operationResult = operation.apply(this.doc);
        this.didUpdateEventEmitter.emit({ operationResult: operationResult });
        return operationResult;
    }

    onDidUpdate(listener: IEventListener<IDidUpdateModelStateEvent>) {
        return this.didUpdateEventEmitter.on(listener);
    }
}
