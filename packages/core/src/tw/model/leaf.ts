import { IModelNode, ModelNode } from './node';

export interface IModelLeaf<TAttributes> extends IModelNode<TAttributes> {}

export abstract class ModelLeaf<TAttributes> extends ModelNode<TAttributes> implements IModelLeaf<TAttributes> {
    constructor(componentId: string, id: string, text: string, attributes: TAttributes) {
        super(componentId, id, text, attributes, []);
    }

    get root() {
        return false;
    }

    get leaf() {
        return true;
    }
}
