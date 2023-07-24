import { generateId } from '../../util/id';
import { ModelNode } from '../node';
import { Path } from '../path';
import { Mapping } from './mapping';
import { Merge } from './merge';
import { Operation, OperationResult } from './operation';

export class Split extends Operation {
    constructor(protected path: Path) {
        super();
        if (path.length === 0) {
            throw new Error('Split is not supported for the root node.');
        }
    }

    map(mapping: Mapping) {
        return new Split(mapping.map(this.path));
    }

    apply(doc: ModelNode<unknown>): OperationResult {
        const parent = doc.findNodeByPath(this.path.slice(0, this.path.length - 2));
        const node = parent.findNodeByPath([this.path[this.path.length - 2]]);
        const deletedContent = node.spliceChildren(
            this.path[this.path.length - 1],
            node.children.length - this.path[this.path.length - 1],
            [],
        );
        const newNode = new ModelNode({
            id: generateId(),
            componentId: node.componentId,
            attributes: node.attributes,
            marks: node.marks.slice(),
            children: deletedContent,
        });
        parent.spliceChildren(this.path[this.path.length - 2] + 1, 0, [newNode]);
        return {
            operation: this,
            reverseOperation: new Merge(this.path.slice(0, this.path.length - 1)),
            mapping: new Mapping([
                {
                    path: this.path.slice(0, this.path.length - 2),
                    start: this.path[this.path.length - 2],
                    endBefore: this.path[this.path.length - 2],
                    endAfter: this.path[this.path.length - 2] + 1,
                },
            ]),
        };
    }
}
