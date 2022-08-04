import { EventEmitter } from '../event/emitter';
import { EventListener } from '../event/listener';
import { DocModelNode } from './nodes/doc';
import { Operation, OperationResult } from './operation/operation';

export interface DidUpdateModelStateEvent {
    operationResult: OperationResult;
}

export class ModelState {
    protected didUpdateEventEmitter = new EventEmitter<DidUpdateModelStateEvent>();

    constructor(readonly doc: DocModelNode<any>) {}

    applyOperation(operation: Operation) {
        const operationResult = operation.apply(this.doc);
        this.didUpdateEventEmitter.emit({ operationResult: operationResult });
        return operationResult;
    }

    onDidUpdate(listener: EventListener<DidUpdateModelStateEvent>) {
        return this.didUpdateEventEmitter.on(listener);
    }
}
