import { IModelNode, ModelNode } from './node';
import { ISlice } from './slice';

export interface IModelBranch<TAttributes> extends IModelNode<TAttributes> {}

export abstract class ModelBranch<TAttributes> extends ModelNode<TAttributes> implements IModelBranch<TAttributes> {
    constructor(componentId: string, id: string, attributes: TAttributes, children: IModelNode<any>[]) {
        super(componentId, id, '', attributes, children);
        if (children.length === 0) {
            throw new Error('Branch node must have children.');
        }
    }

    get root() {
        return false;
    }

    get leaf() {
        return false;
    }

    replace(from: number, to: number, slice: ISlice) {
        super.replace(from, to, slice);
        if (this.children.length === 0) {
            throw new Error('Branch node must have children.');
        }
    }
}
