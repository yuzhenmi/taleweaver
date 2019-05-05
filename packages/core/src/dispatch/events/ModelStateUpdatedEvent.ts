import Event from '../Event';

class ModelStateUpdatedEvent extends Event {

  static getType() {
    return 'ModelStateUpdated';
  }
}

export default ModelStateUpdatedEvent;
