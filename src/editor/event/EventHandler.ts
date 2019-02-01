import State from '../state/State';
import Event from './Event';
import CursorTransformation from '../state/CursorTransformation';
import DocumentTransformation from '../state/DocumentTransformation';

export type EventHandlerOutcome = {
  cursorTransformations: CursorTransformation[];
  documentTransformations: DocumentTransformation[];
};

export default interface EventHandler {
  handle(event: Event, state: State): EventHandlerOutcome;
}
