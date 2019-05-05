import Event from '../Event';

class ViewStateUpdatedEvent extends Event {

  static getType() {
    return 'ViewStateUpdated';
  }
}

export default ViewStateUpdatedEvent;
