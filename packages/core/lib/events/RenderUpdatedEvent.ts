import { AnyRenderNode } from '../render/RenderNode';
import Event from './Event';

class RenderUpdatedEvent extends Event {
    static getType() {
        return 'RenderUpdated';
    }

    protected updatedNode: AnyRenderNode;

    constructor(updatedNode: AnyRenderNode) {
        super();
        this.updatedNode = updatedNode;
    }

    getUpdatedNode() {
        return this.updatedNode;
    }
}

export default RenderUpdatedEvent;
