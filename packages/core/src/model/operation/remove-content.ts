import { IContent, IDocModelNode } from '../node';
import { IPoint } from '../position';
import { InsertContent } from './insert-content';
import { IMapping, Mapping } from './mapping';
import { IOperationResult, Operation } from './operation';

export class RemoveContent extends Operation {
    constructor(protected position: IPoint, protected length: number) {
        super();
    }

    map(mapping: IMapping) {
        const newPosition = mapping.map(this.position);
        const newEndPosition = mapping.map({
            path: this.position.path,
            offset: this.position.offset + this.length,
        });
        return new RemoveContent(newPosition, newEndPosition.offset - newPosition.offset);
    }

    apply(doc: IDocModelNode): IOperationResult {
        const node = doc.findByPath(this.position.path);
        let removedContent: IContent;
        switch (node.type) {
            case 'block': {
                removedContent = node.removeContent(this.position.offset, this.length);
                break;
            }
            default: {
                throw new Error('Node does not have content.');
            }
        }
        return {
            change: this,
            reverseOperation: new InsertContent(this.position, removedContent),
            mapping: new Mapping([
                {
                    path: this.position.path,
                    start: this.position.offset,
                    endBefore: this.position.offset + this.length,
                    endAfter: this.position.offset,
                },
            ]),
        };
    }
}
