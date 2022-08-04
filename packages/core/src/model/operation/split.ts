import { generateId } from '../../util/id';
import { Point } from '../nodes/base';
import { BlockModelNode } from '../nodes/block';
import { DocModelNode } from '../nodes/doc';
import { Mapping } from './mapping';
import { Merge } from './merge';
import { OperationResult, Operation } from './operation';

export class Split extends Operation {
    constructor(protected point: Point) {
        super();
        if (this.point.path.length === 0) {
            throw new Error('Cannot split doc.');
        }
    }

    map(mapping: Mapping) {
        return new Split(mapping.map(this.point));
    }

    apply(doc: DocModelNode<any>): OperationResult {
        const node = doc.findByPath(this.point.path);
        let newNode: typeof node;
        switch (node.type) {
            case 'block': {
                const removed = node.spliceChildren(this.point.offset, node.children.length - this.point.offset, [
                    '\n',
                ]);
                newNode = new BlockModelNode(
                    node.componentId,
                    generateId(),
                    node.attributes,
                    node.marks.slice(),
                    removed,
                );
                break;
            }
            default:
                throw new Error(`Split is not supported for ${node.type} node.`);
        }
        const nodeStart: Point = {
            path: this.point.path.slice(0, this.point.path.length - 1),
            offset: this.point.path[this.point.path.length - 1],
        };
        const parent = doc.findByPath(nodeStart.path);
        switch (parent.type) {
            case 'doc': {
                parent.spliceChildren(nodeStart.offset, 1, [node, newNode] as any);
                break;
            }
            default:
                throw new Error(`Split is not supported for ${parent.type}'s child.`);
        }
        return {
            operation: this,
            reverseOperation: new Merge(nodeStart),
            mapping: new Mapping([
                {
                    start: nodeStart,
                    endBefore: nodeStart.offset,
                    endAfter: nodeStart.offset + 1,
                },
            ]),
        };
    }
}
