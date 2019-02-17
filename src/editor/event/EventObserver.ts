import TaleWeaver from '../TaleWeaver';
import Event from './Event';
import CursorCommand from '../command/CursorCommand';
import DocumentCommand from '../command/DocumentCommand';

export default abstract class EventObserver {
  protected taleWeaver: TaleWeaver;

  constructor(taleWeaver: TaleWeaver) {
    this.taleWeaver = taleWeaver;
  }

  dispatchCursorCommand(cursorCommand: CursorCommand) {
    const cursorTransformation = cursorCommand(this.taleWeaver);
    this.taleWeaver.getState().applyEditorCursorTransformation(cursorTransformation);
  }

  dispatchDocumentCommand(documentCommand: DocumentCommand) {
    const documentTransformation = documentCommand(this.taleWeaver);
    this.taleWeaver.getState().applyDocumentTransformation(documentTransformation);
  }

  abstract onEvent(event: Event): void;
}
