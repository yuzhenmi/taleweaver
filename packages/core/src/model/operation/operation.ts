import { DocModelNode } from '../nodes/doc';
import { Mapping } from './mapping';

export abstract class Operation {
    abstract map(mapping: Mapping): Operation;
    abstract apply(root: DocModelNode<any>): OperationResult;
}

export interface OperationResult {
    readonly operation: Operation;
    readonly reverseOperation: Operation;
    readonly mapping: Mapping;
}
