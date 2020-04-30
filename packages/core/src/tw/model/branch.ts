import { IModelNode, ModelNode } from './node';

export interface IBranch<TAttributes> extends IModelNode<TAttributes> {}

export abstract class Branch<TAttributes> extends ModelNode<TAttributes> implements IBranch<TAttributes> {
    get root() {
        return false;
    }

    get leaf() {
        return false;
    }
}
