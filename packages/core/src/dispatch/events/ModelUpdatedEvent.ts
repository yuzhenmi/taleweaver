import { AnyModelNode } from '../../model/ModelNode';
import Event from '../Event';

class ModelUpdatedEvent extends Event {
  static getType() {
    return 'ModelUpdated';
  }

  protected updatedNode: AnyModelNode;

  constructor(updatedNode: AnyModelNode) {
    super();
    this.updatedNode = updatedNode;
  }

  getUpdatedNode() {
    return this.updatedNode;
  }
}

export default ModelUpdatedEvent;
