import { Point } from '../nodes/base';
import { DocModelNode } from '../nodes/doc';
import { identity, Mapping } from './mapping';
import { OperationResult, Operation } from './operation';

export class SetAttribute<TAttributes> extends Operation {
    constructor(protected point: Point, protected attributes: TAttributes) {
        super();
    }

    map(mapping: Mapping) {
        return new SetAttribute(mapping.map(this.point), this.attributes);
    }

    apply(doc: DocModelNode<any>): OperationResult {
        const node = doc.findByPath([...this.point.path, this.point.offset]);
        const prevAttributes = node.attributes;
        node.setAttributes(this.attributes);
        return {
            operation: this,
            reverseOperation: new SetAttribute(this.point, prevAttributes),
            mapping: identity,
        };
    }
}
