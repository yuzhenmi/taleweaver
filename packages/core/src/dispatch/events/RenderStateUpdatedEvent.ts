import Event from '../Event';

class RenderStateUpdatedEvent extends Event {

  static getType() {
    return 'RenderStateUpdated';
  }
}

export default RenderStateUpdatedEvent;
