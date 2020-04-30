import { IModelNode, ModelNode } from './node';

export interface IRoot<TAttributes> extends IModelNode<TAttributes> {}

export abstract class Root<TAttributes> extends ModelNode<TAttributes> implements IRoot<TAttributes> {
    get root() {
        return true;
    }

    get leaf() {
        return false;
    }
}
