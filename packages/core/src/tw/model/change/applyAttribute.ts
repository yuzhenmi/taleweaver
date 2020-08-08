import { IComponentService } from '../../component/service';
import { IModelRoot } from '../root';
import { IChangeResult, ModelChange } from './change';
import { identity, IMapping } from './mapping';
import { IPosition } from '../../tree/position';

export class ApplyAttribute extends ModelChange {
    constructor(protected position: IPosition, protected key: string, protected value: any) {
        super();
    }

    map(mapping: IMapping) {
        return this;
    }

    apply(root: IModelRoot<any>, componentService: IComponentService): IChangeResult {
        const resolvedPosition = root.resolvePosition(this.position);
        const { node: parent, offset } = resolvedPosition[resolvedPosition.length - 1];
        if (parent.leaf) {
            throw new Error('Cannot apply attribute on text.');
        }
        const node = parent.children.at(offset);
        const originalValue = node.applyAttribute(this.key, this.value);
        return {
            change: this,
            reverseChange: new ApplyAttribute(this.position, this.key, originalValue),
            mapping: identity,
        };
    }
}
