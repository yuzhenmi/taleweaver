import { ModelNode } from '../node';
import { identity, Mapping } from './mapping';
import { Operation, OperationResult } from './operation';

export class Nothing extends Operation {
    constructor() {
        super();
    }

    map(mapping: Mapping) {
        return this;
    }

    apply(root: ModelNode<unknown>): OperationResult {
        return {
            operation: this,
            reverseOperation: this,
            mapping: identity,
        };
    }
}
