import { ModelNode } from '../nodes';
import { Point } from '../nodes/base';
import { DocModelNode } from '../nodes/doc';
import { Mapping } from './mapping';
import { OperationResult, Operation } from './operation';

export class Splice extends Operation {
    constructor(protected start: Point, protected deleteCount: number, protected content: Array<ModelNode | string>) {
        super();
    }

    map(mapping: Mapping) {
        const oldStart = this.start;
        const oldEnd = { path: this.start.path, offset: this.start.offset + this.deleteCount };
        const newStart = mapping.map(oldStart);
        const newEnd = mapping.map(oldEnd);
        const newDeleteCount = newEnd.offset - newStart.offset;
        return new Splice(newStart, newDeleteCount, this.content);
    }

    apply(doc: DocModelNode<any>): OperationResult {
        const node = doc.findByPath(this.start.path);
        let removed: Array<ModelNode | string>;
        switch (node.type) {
            case 'doc': {
                if (!node.validateChildren(this.content)) {
                    throw new Error('Invalid children for doc.');
                }
                removed = node.spliceChildren(this.start.offset, this.deleteCount, this.content as any);
                break;
            }
            case 'block': {
                if (!node.validateChildren(this.content)) {
                    throw new Error('Invalid children for block.');
                }
                removed = node.spliceChildren(this.start.offset, this.deleteCount, this.content as any);
                break;
            }
            default: {
                throw new Error('Invalid node for applying Splice operation.');
            }
        }
        return {
            operation: this,
            reverseOperation: new Splice(this.start, this.content.length, removed),
            mapping: new Mapping([
                {
                    start: this.start,
                    endBefore: this.start.offset + this.deleteCount,
                    endAfter: this.start.offset + this.content.length,
                },
            ]),
        };
    }
}
