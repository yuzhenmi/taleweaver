import { AnyLayoutNode } from '../../layout/LayoutNode';
import Event from '../Event';

class LayoutUpdatedEvent extends Event {
    static getType() {
        return 'LayoutUpdated';
    }

    protected updatedNode: AnyLayoutNode;

    constructor(updatedNode: AnyLayoutNode) {
        super();
        this.updatedNode = updatedNode;
    }

    getUpdatedNode() {
        return this.updatedNode;
    }
}

export default LayoutUpdatedEvent;
