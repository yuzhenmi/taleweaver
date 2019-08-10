import Event from './Event';

class CursorUpdatedEvent extends Event {

    static getType() {
        return 'CursorUpdated';
    }
}

export default CursorUpdatedEvent;
