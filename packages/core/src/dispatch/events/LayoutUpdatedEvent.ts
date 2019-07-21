import Event from '../Event';

class LayoutUpdatedEvent extends Event {

  static getType() {
    return 'LayoutUpdated';
  }
}

export default LayoutUpdatedEvent;
