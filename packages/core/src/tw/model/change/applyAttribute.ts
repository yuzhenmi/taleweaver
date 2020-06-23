import { IComponentService } from '../../component/service';
import { IModelRoot } from '../root';
import { IChangeResult, ModelChange } from './change';
import { identity, IMapping } from './mapping';

export class ApplyAttribute extends ModelChange {
    constructor(protected path: string[], protected key: string, protected value: any) {
        super();
    }

    map(mapping: IMapping) {
        return this;
    }

    apply(root: IModelRoot<any>, componentService: IComponentService): IChangeResult {
        let node = root;
        const path = this.path.slice();
        let id = path.shift();
        if (id !== node.id) {
            throw new Error('Path cannot be resolved.');
        }
        while ((id = path.shift())) {
            const childNode = node.children.find((child) => child.id === id);
            if (!childNode) {
                throw new Error('Path cannot be resolved.');
            }
            node = childNode;
        }
        const originalValue = node.applyAttribute(this.key, this.value);
        return {
            change: this,
            reverseChange: new ApplyAttribute(this.path, this.key, originalValue),
            mapping: identity,
        };
    }
}
