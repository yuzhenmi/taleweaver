import TaleWeaver from '../TaleWeaver';
import Event from './Event';
import CursorCommand from '../cursorcommand/CursorCommand';
import StateCommand from '../statecommand/StateCommand';

export default abstract class EventObserver {
  protected taleWeaver: TaleWeaver;

  constructor(taleWeaver: TaleWeaver) {
    this.taleWeaver = taleWeaver;
  }

  dispatchCursorCommand(cursorCommand: CursorCommand) {
    const cursorTransformation = cursorCommand(this.taleWeaver);
    this.taleWeaver.applyEditorCursorTransformation(cursorTransformation);
  }

  dispatchStateCommand(stateCommand: StateCommand) {
    const stateTransformation = stateCommand(this.taleWeaver);
    this.taleWeaver.applyStateTransformation(stateTransformation);
  }

  abstract onEvent(event: Event): void;
}
