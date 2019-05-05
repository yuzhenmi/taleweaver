import Event from '../Event';

class TokenStateUpdatedEvent extends Event {

  static getType() {
    return 'TokenStateUpdated';
  }
}

export default TokenStateUpdatedEvent;
