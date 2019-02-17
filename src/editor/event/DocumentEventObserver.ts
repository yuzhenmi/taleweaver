import EventObserver from './EventObserver';
import Event, { KeyPressEvent } from './Event';
import {
  insertText,
} from '../command/document';

export default class DocumentEventObserver extends EventObserver {
  onEvent(event: Event) {
    if (event instanceof KeyPressEvent) {
      const keyPressEvent = <KeyPressEvent> event;
      if (keyPressEvent.key === 'a') {
        this.dispatchDocumentCommand(insertText('a'));
      }
    }
  }
}
