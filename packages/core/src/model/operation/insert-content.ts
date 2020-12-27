import { IContent, IDocModelNode } from '../node';
import { IPoint } from '../position';
import { IMapping, Mapping } from './mapping';
import { IOperationResult, Operation } from './operation';
import { RemoveContent } from './remove-content';

export class InsertContent extends Operation {
    constructor(protected position: IPoint, protected content: IContent) {
        super();
    }

    map(mapping: IMapping) {
        return new InsertContent(mapping.map(this.position), this.content);
    }

    apply(doc: IDocModelNode): IOperationResult {
        const node = doc.findByPath(this.position.path);
        switch (node.type) {
            case 'block': {
                node.insertContent(this.content, this.position.offset);
                break;
            }
            default: {
                throw new Error('Node does not have content.');
            }
        }
        return {
            change: this,
            reverseOperation: new RemoveContent(this.position, this.content.length),
            mapping: new Mapping([
                {
                    path: this.position.path,
                    start: this.position.offset,
                    endBefore: this.position.offset,
                    endAfter: this.position.offset + this.content.length,
                },
            ]),
        };
    }
}
