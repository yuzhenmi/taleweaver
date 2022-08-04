import { Point } from '../nodes/base';
import { DocModelNode } from '../nodes/doc';
import { Mapping } from './mapping';
import { OperationResult, Operation } from './operation';
import { Split } from './split';

export class Merge extends Operation {
    constructor(protected point: Point) {
        super();
    }

    map(mapping: Mapping) {
        return new Merge(mapping.map(this.point));
    }

    apply(doc: DocModelNode<any>): OperationResult {
        const parent = doc.findByPath(this.point.path);
        let mergedAt: number;
        switch (parent.type) {
            case 'doc': {
                const node = parent.children[this.point.offset];
                const sibling = parent.children[this.point.offset + 1];
                switch (node.type) {
                    case 'block': {
                        mergedAt = node.children.length - 1;
                        node.spliceChildren(mergedAt, 1, sibling.children.slice());
                        break;
                    }
                    default:
                        throw new Error(`Merge is not supported for ${node.type} node.`);
                }
                parent.spliceChildren(this.point.offset + 1, 1, []);
                break;
            }
            default:
                throw new Error(`Merge is not supported for ${parent.type}'s children.`);
        }
        return {
            operation: this,
            reverseOperation: new Split({ path: [...this.point.path, this.point.offset], offset: mergedAt }),
            mapping: new Mapping([
                {
                    start: this.point,
                    endBefore: this.point.offset + 1,
                    endAfter: this.point.offset,
                },
            ]),
        };
    }
}
