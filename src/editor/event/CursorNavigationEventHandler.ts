import EventHandler, { EventHandlerOutcome } from '../event/EventHandler';
import Event, { KeyPressEvent } from '../event/Event';
import State from '../state/State';
import CursorTransformation from '../state/CursorTransformation';
import { translateCursor } from '../state/helpers/cursorTransformations';

export default class CursorNavigationEventHandler implements EventHandler {
  handle(event: Event, state: State): EventHandlerOutcome {
    const cursorTransformations: CursorTransformation[] = [];
    if (event instanceof KeyPressEvent) {
      const keyPressEvent = <KeyPressEvent> event;
      if (keyPressEvent.key === 'ArrowLeft') {
        cursorTransformations.push(translateCursor(-1));
      } else if (keyPressEvent.key === 'ArrowRight') {
        cursorTransformations.push(translateCursor(1));
      }
    }
    return {
      cursorTransformations,
      documentTransformations: [],
    };
  }
}
