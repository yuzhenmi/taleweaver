import TaleWeaver from '../TaleWeaver';
import Event from './Event';
import CursorCommand from '../command/CursorCommand';

export default abstract class EventObserver {
  protected taleWeaver: TaleWeaver;

  constructor(taleWeaver: TaleWeaver) {
    this.taleWeaver = taleWeaver;
  }

  dispatchCursorCommand(cursorCommand: CursorCommand) {
    const cursorTransformation = cursorCommand(this.taleWeaver);
    this.taleWeaver.getState().applyEditorCursorTransformation(cursorTransformation);
  }

  abstract onEvent(event: Event): void;
}
