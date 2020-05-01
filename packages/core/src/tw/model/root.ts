import { IModelNode, ModelNode } from './node';

export interface IModelRoot<TAttributes> extends IModelNode<TAttributes> {}

export abstract class ModelRoot<TAttributes> extends ModelNode<TAttributes> implements IModelRoot<TAttributes> {
    get root() {
        return true;
    }

    get leaf() {
        return false;
    }
}
