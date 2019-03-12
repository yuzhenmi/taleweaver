import EventObserver from './EventObserver';
import Event, { KeyPressEvent } from './Event';
import {
  insertText,
} from '../state/commands';

export default class StateEventObserver extends EventObserver {
  onEvent(event: Event) {
    if (event instanceof KeyPressEvent) {
      const keyPressEvent = <KeyPressEvent> event;
      if (keyPressEvent.key === 'a') {
        this.dispatchStateCommand(insertText(5, 'a'));
      }
    }
  }
}
