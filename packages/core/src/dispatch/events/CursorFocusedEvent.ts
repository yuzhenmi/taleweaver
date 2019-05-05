import Event from '../Event';

class CursorFocusedEvent extends Event {

  static getType() {
    return 'CursorFocused';
  }
}

export default CursorFocusedEvent;
