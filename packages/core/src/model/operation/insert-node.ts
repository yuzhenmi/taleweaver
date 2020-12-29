import { IDocModelNode, IModelNode } from '../node';
import { IPath } from '../position';
import { IMapping, Mapping } from './mapping';
import { IOperationResult, Operation } from './operation';
import { RemoveNode } from './remove-node';

export class InsertNode extends Operation {
    constructor(protected path: IPath, protected at: number, protected node: IModelNode) {
        super();
    }

    map(mapping: IMapping) {
        const newPath = mapping.map([...this.path, this.at]);
        const newAt = newPath.pop()!;
        return new InsertNode(newPath, newAt, this.node);
    }

    apply(doc: IDocModelNode): IOperationResult {
        const parent = doc.findByPath(this.path);
        switch (parent.type) {
            case 'doc': {
                parent.insertChild(this.node as any, this.at);
                break;
            }
            default: {
                throw new Error('Invalid parent type for node insertion.');
            }
        }
        return {
            change: this,
            reverseOperation: new RemoveNode(this.path, this.at),
            mapping: new Mapping([
                {
                    path: this.path,
                    start: this.at,
                    endBefore: this.at,
                    endAfter: this.at + 1,
                },
            ]),
        };
    }
}
