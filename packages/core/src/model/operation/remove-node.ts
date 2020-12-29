import { IDocModelNode, IModelNode } from '../node';
import { IPath } from '../position';
import { InsertNode } from './insert-node';
import { IMapping, Mapping } from './mapping';
import { IOperationResult, Operation } from './operation';

export class RemoveNode extends Operation {
    constructor(protected path: IPath, protected at: number) {
        super();
    }

    map(mapping: IMapping) {
        const newPath = mapping.map([...this.path, this.at]);
        const newAt = newPath.pop()!;
        return new RemoveNode(newPath, newAt);
    }

    apply(doc: IDocModelNode): IOperationResult {
        const parent = doc.findByPath(this.path);
        let node: IModelNode;
        switch (parent.type) {
            case 'doc': {
                node = parent.children[this.at];
                parent.removeChild(node);
                break;
            }
            default: {
                throw new Error('Invalid parent type for node removal.');
            }
        }
        return {
            change: this,
            reverseOperation: new InsertNode(this.path, this.at, node),
            mapping: new Mapping([
                {
                    path: this.path,
                    start: this.at,
                    endBefore: this.at + 1,
                    endAfter: this.at,
                },
            ]),
        };
    }
}
