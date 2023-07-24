import { EventEmitter } from '../event/emitter';
import { EventListener } from '../event/listener';
import { ModelNode } from './node';
import { Operation, OperationResult } from './operation/operation';

/**
 * The event emitted when the model tree is updated.
 */
export interface DidUpdateModelTreeEvent {
    operationResult: OperationResult;
}

/**
 * The model service is responsible for managing the model.
 */
export class ModelService {
    protected didUpdateModelTreeEventEmitter = new EventEmitter<DidUpdateModelTreeEvent>();

    constructor(readonly root: ModelNode<unknown>) {}

    /**
     * Applies an operation to the model tree.
     * @param operation The operation to apply.
     * @returns The result of the operation.
     */
    applyOperation(operation: Operation) {
        const operationResult = operation.apply(this.root);
        this.didUpdateModelTreeEventEmitter.emit({ operationResult: operationResult });
        return operationResult;
    }

    /**
     * Adds a listener for when the model tree is updated.
     * @param listener The listener to add.
     * @returns A function that removes the listener.
     */
    onDidUpdateModelTreeState(listener: EventListener<DidUpdateModelTreeEvent>) {
        return this.didUpdateModelTreeEventEmitter.on(listener);
    }
}
