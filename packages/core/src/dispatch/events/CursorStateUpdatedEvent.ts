import Event from '../Event';

class CursorStateUpdatedEvent extends Event {

  static getType() {
    return 'CursorStateUpdated';
  }
}

export default CursorStateUpdatedEvent;
