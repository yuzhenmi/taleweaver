import EventHandler, { Event, EventHandlerOutcome } from './EventHandler';
import State from '../state/State';

export default class CursorNavigationEventHandler implements EventHandler {
  handle(event: Event, state: State): EventHandlerOutcome {
    return {
      cursorTransformations: [],
      documentTransformations: [],
    };
  }
}
