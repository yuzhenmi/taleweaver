import ModelNode from '../../model/ModelNode';
import Event from '../Event';

type AnyModelNode = ModelNode<any, any, any>;

class ModelUpdatedEvent extends Event {
  static getType() {
    return 'ModelUpdated';
  }

  protected updatedNode: AnyModelNode;

  constructor(updatedNode: AnyModelNode) {
    super();
    this.updatedNode = updatedNode;
  }
}

export default ModelUpdatedEvent;
