import { AnyViewNode } from '../../view/ViewNode';
import Event from '../Event';

class ViewUpdatedEvent extends Event {
    static getType() {
        return 'ViewUpdated';
    }

    protected updatedNode: AnyViewNode;

    constructor(updatedNode: AnyViewNode) {
        super();
        this.updatedNode = updatedNode;
    }

    getUpdatedNode() {
        return this.updatedNode;
    }
}

export default ViewUpdatedEvent;
