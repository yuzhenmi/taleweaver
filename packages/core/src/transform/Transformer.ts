import Editor from '../Editor';
import Transformation from './Transformation';
import History from './History';

class Transformer {
  protected editor: Editor;
  protected history: History;

  constructor(editor: Editor) {
    this.editor = editor;
    this.history = new History(editor);
  }

  applyTransformation(transformation: Transformation) {
    const appliedTransformation = this.applyTransformationWithoutHistory(transformation);
    this.history.recordAppliedTransformation(appliedTransformation);
  }

  undo() {
    const historyItemToUndo = this.history.undo();
    if (!historyItemToUndo) {
      return;
    }
    const tokenManager = this.editor.getTokenManager();
    const cursor = this.editor.getCursor();
    historyItemToUndo.getAppliedTransformations().reverse().forEach(appliedTransformation => {
      tokenManager.unapplyTransformation(appliedTransformation);
      cursor.set(
        appliedTransformation.getOriginalCursorAnchor(),
        appliedTransformation.getOriginalCursorHead(),
        appliedTransformation.getOriginalCursorLockLeft(),
      );
    });
  }

  redo() {
    const historyItemToRedo = this.history.redo();
    if (!historyItemToRedo) {
      return;
    }
    historyItemToRedo.getAppliedTransformations().forEach(appliedTransformation => {
      const originalTransformation = appliedTransformation.getOriginalTransformation();
      this.applyTransformationWithoutHistory(originalTransformation);
    });
  }

  protected applyTransformationWithoutHistory(transformation: Transformation) {
    const tokenManager = this.editor.getTokenManager();
    const cursor = this.editor.getCursor();
    const appliedTransformation = tokenManager.applyTransformation(transformation);
    let cursorAnchor = transformation.getCursorAnchor();
    if (cursorAnchor === null)  {
      cursorAnchor = cursor.getAnchor();
    }
    let cursorHead = transformation.getCursorHead();
    if (cursorHead === null)  {
      cursorHead = cursor.getHead();
    }
    cursor.set(cursorAnchor, cursorHead, transformation.getCursorLockLeft());
    return appliedTransformation;
  }
}

export default Transformer;
