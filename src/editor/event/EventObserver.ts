import TaleWeaver from '../TaleWeaver';
import Event from './Event';
import CursorCommand from '../cursor/commands/Command';
import StateCommand from '../state/commands/Command';

export default abstract class EventObserver {
  protected taleWeaver: TaleWeaver;

  constructor(taleWeaver: TaleWeaver) {
    this.taleWeaver = taleWeaver;
  }

  dispatchCursorCommand(cursorCommand: CursorCommand) {
    const editorCursor = this.taleWeaver.getEditorCursor();
    if (!editorCursor) {
      return;
    }
    const cursorTransformation = cursorCommand(this.taleWeaver);
    editorCursor.transform(cursorTransformation);
  }

  dispatchStateCommand(stateCommand: StateCommand) {
    const stateTransformation = stateCommand(this.taleWeaver);
    this.taleWeaver.getState().transform(stateTransformation);
  }

  abstract onEvent(event: Event): void;
}
