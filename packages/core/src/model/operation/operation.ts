import { ModelNode } from '../node';
import { Mapping } from './mapping';

export abstract class Operation {
    abstract map(mapping: Mapping): Operation;
    abstract apply(root: ModelNode<unknown>): OperationResult;
}

export interface OperationResult {
    readonly operation: Operation;
    readonly reverseOperation: Operation;
    readonly mapping: Mapping;
}
