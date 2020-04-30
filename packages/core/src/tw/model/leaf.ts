import { IModelNode, ModelNode } from './node';

export interface ILeaf<TAttributes> extends IModelNode<TAttributes> {}

export abstract class Leaf<TAttributes> extends ModelNode<TAttributes> implements ILeaf<TAttributes> {
    get root() {
        return false;
    }

    get leaf() {
        return true;
    }
}
