import Event from '../Event';

class LayoutStateUpdatedEvent extends Event {

  static getType() {
    return 'LayoutStateUpdated';
  }
}

export default LayoutStateUpdatedEvent;
