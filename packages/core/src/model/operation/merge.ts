import { ModelNode } from '../node';
import { Path } from '../path';
import { Mapping } from './mapping';
import { Operation, OperationResult } from './operation';
import { Split } from './split';

/**
 * A merge operation.
 */
export class Merge extends Operation {
    constructor(protected path: Path) {
        super();
    }

    map(mapping: Mapping) {
        return new Merge(mapping.map(this.path));
    }

    apply(root: ModelNode<unknown>): OperationResult {
        const parent = root.findNodeByPath(this.path.slice(0, this.path.length - 1));
        if (this.path[this.path.length - 1] >= parent.children.length - 1) {
            throw new Error('Merge is not supported for the last child.');
        }
        const node = parent.children[this.path[this.path.length - 1]];
        const sibling = parent.children[this.path[this.path.length - 1] + 1];
        if (typeof node === 'string' || typeof sibling === 'string') {
            throw new Error('Merge is not supported for text node.');
        }
        const mergedAt = node.children.length - 1;
        node.spliceChildren(mergedAt, 0, sibling.children.slice());
        parent.spliceChildren(this.path[this.path.length - 1] + 1, 1, []);
        return {
            operation: this,
            reverseOperation: new Split([...this.path, mergedAt]),
            mapping: new Mapping([
                {
                    path: this.path.slice(0, this.path.length - 1),
                    start: this.path[this.path.length - 1],
                    endBefore: this.path[this.path.length - 1] + 1,
                    endAfter: this.path[this.path.length - 1],
                },
            ]),
        };
    }
}
