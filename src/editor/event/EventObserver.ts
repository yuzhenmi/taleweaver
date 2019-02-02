import TaleWeaver from '../TaleWeaver';
import Event from './Event';
import CursorTransformation from '../state/CursorTransformation';

export default abstract class EventObserver {
  protected taleWeaver: TaleWeaver;

  constructor(taleWeaver: TaleWeaver) {
    this.taleWeaver = taleWeaver;
  }
  
  dispatchEditorCursorTransformation(transformation: CursorTransformation) {
    this.taleWeaver.getState().transformEditorCursor(transformation);
  }

  abstract notify(event: Event, taleWeaver: TaleWeaver): void;
}
