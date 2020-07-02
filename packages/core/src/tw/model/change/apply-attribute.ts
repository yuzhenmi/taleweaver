import { IComponentService } from '../../component/service';
import { IModelNode } from '../node';
import { IModelPosition } from '../position';
import { IModelRoot } from '../root';
import { IChangeResult, ModelChange } from './change';
import { identity, IMapping } from './mapping';

export class ApplyAttribute extends ModelChange {
    constructor(protected position: IModelPosition, protected key: string, protected value: any) {
        super();
    }

    map(mapping: IMapping) {
        return this;
    }

    apply(root: IModelRoot<any>, componentService: IComponentService): IChangeResult {
        return this.applyNode(root, this.position);
    }

    protected applyNode(node: IModelNode<any>, position: IModelPosition): IChangeResult {
        if (position.length === 0) {
            const originalValue = node.applyAttribute(this.key, this.value);
            return {
                change: this,
                reverseChange: new ApplyAttribute(this.position, this.key, originalValue),
                mapping: identity,
            };
        }
        const offset = position[0];
        return this.applyNode(node.children.at(offset), position.slice(1));
    }
}
