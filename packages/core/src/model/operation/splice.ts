import { ModelNode } from '../node';
import { Path } from '../path';
import { Mapping } from './mapping';
import { Operation, OperationResult } from './operation';

export class Splice extends Operation {
    constructor(
        protected path: Path,
        protected deleteCount: number,
        protected content: Array<ModelNode<unknown> | string>,
    ) {
        super();
    }

    map(mapping: Mapping) {
        const oldPath = this.path;
        const oldDeleteToPath = [
            ...oldPath.slice(0, oldPath.length - 1),
            oldPath[oldPath.length - 1] + this.deleteCount,
        ];
        const newPath = mapping.map(oldPath);
        const newDeleteToPath = mapping.map(oldDeleteToPath);
        const newDeleteCount = newDeleteToPath[newDeleteToPath.length - 1] - newPath[newPath.length - 1];
        return new Splice(newPath, newDeleteCount, this.content);
    }

    apply(root: ModelNode<unknown>): OperationResult {
        const node = root.findNodeByPath(this.path.slice(0, this.path.length - 1));
        const deletedContent = node.spliceChildren(this.path[this.path.length - 1], this.deleteCount, this.content);
        return {
            operation: this,
            reverseOperation: new Splice(this.path, this.content.length, deletedContent),
            mapping: new Mapping([
                {
                    path: this.path.slice(0, this.path.length - 1),
                    start: this.path[this.path.length - 1],
                    endBefore: this.path[this.path.length - 1] + this.deleteCount,
                    endAfter: this.path[this.path.length - 1] + this.content.length,
                },
            ]),
        };
    }
}
