import { IModelNode, ModelNode } from './node';
import { ISlice } from './slice';

export interface IModelRoot<TAttributes> extends IModelNode<TAttributes> {}

export abstract class ModelRoot<TAttributes> extends ModelNode<TAttributes> implements IModelRoot<TAttributes> {
    constructor(componentId: string, id: string, attributes: TAttributes, children: IModelNode<any>[]) {
        super(componentId, id, '', attributes, children);
        if (children.length === 0) {
            throw new Error('Doc node must have children.');
        }
    }

    get root() {
        return true;
    }

    get leaf() {
        return false;
    }

    replace(from: number, to: number, slice: ISlice) {
        super.replace(from, to, slice);
        if (this.children.length === 0) {
            throw new Error('Root node must have children.');
        }
    }
}
