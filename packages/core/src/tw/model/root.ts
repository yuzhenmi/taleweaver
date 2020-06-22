import { IModelNode, ModelNode } from './node';

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
}
