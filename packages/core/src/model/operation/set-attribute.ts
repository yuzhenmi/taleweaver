import { IDocModelNode, ISerializableValue } from '../node';
import { IPath } from '../position';
import { identity, IMapping } from './mapping';
import { IOperationResult, Operation } from './operation';

export class SetAttribute extends Operation {
    constructor(protected path: IPath, protected key: string, protected value: ISerializableValue) {
        super();
    }

    map(mapping: IMapping) {
        return new SetAttribute(mapping.map(this.path), this.key, this.value);
    }

    apply(doc: IDocModelNode): IOperationResult {
        const node = doc.findByPath(this.path);
        const originalValue = node.attributes[this.key];
        node.setAttribute(this.key, this.value);
        return {
            change: this,
            reverseOperation: new SetAttribute(this.path, this.key, originalValue),
            mapping: identity,
        };
    }
}
