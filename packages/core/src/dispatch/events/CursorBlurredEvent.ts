import Event from '../Event';

class CursorBlurredEvent extends Event {

    static getType() {
        return 'CursorBlurred';
    }
}

export default CursorBlurredEvent;
