import { IModelNode, ModelNode } from './node';

export interface IModelBranch<TAttributes> extends IModelNode<TAttributes> {}

export abstract class ModelBranch<TAttributes> extends ModelNode<TAttributes> implements IModelBranch<TAttributes> {
    constructor(componentId: string, id: string, attributes: TAttributes) {
        super(componentId, id, '', attributes);
    }

    get root() {
        return false;
    }

    get leaf() {
        return false;
    }
}
