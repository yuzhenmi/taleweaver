import { ModelNode } from '../node';
import { Path } from '../path';
import { identity, Mapping } from './mapping';
import { Operation, OperationResult } from './operation';

export class SetAttribute<TAttributes> extends Operation {
    constructor(protected path: Path, protected attributes: TAttributes) {
        super();
    }

    map(mapping: Mapping) {
        return new SetAttribute(mapping.map(this.path), this.attributes);
    }

    apply(root: ModelNode<unknown>): OperationResult {
        const node = root.findNodeByPath(this.path);
        const prevAttributes = node.attributes;
        node.setAttributes(this.attributes);
        return {
            operation: this,
            reverseOperation: new SetAttribute(this.path, prevAttributes),
            mapping: identity,
        };
    }
}
