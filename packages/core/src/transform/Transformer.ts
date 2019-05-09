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
    const appliedTransformations = this.applyTransformationsWithoutHistory([transformation]);
    appliedTransformations.forEach(appliedTransformation => {
      this.history.recordAppliedTransformation(appliedTransformation);
    });
  }

  undo() {
    const historyItemToUndo = this.history.undo();
    if (!historyItemToUndo) {
      return;
    }
    const tokenManager = this.editor.getTokenManager();
    const appliedTransformations = historyItemToUndo.getAppliedTransformations();
    tokenManager.unapplyTransformations(appliedTransformations);
    const cursor = this.editor.getCursor();
    const firstAppliedTransformation = appliedTransformations[0];
    cursor.set(
      firstAppliedTransformation.getOriginalCursorAnchor(),
      firstAppliedTransformation.getOriginalCursorHead(),
      firstAppliedTransformation.getOriginalCursorLockLeft(),
    );
  }

  redo() {
    const historyItemToRedo = this.history.redo();
    if (!historyItemToRedo) {
      return;
    }
    const transformations = historyItemToRedo.getAppliedTransformations().map(appliedTransformation => appliedTransformation.getOriginalTransformation());
    this.applyTransformationsWithoutHistory(transformations);
  }

  protected applyTransformationsWithoutHistory(transformations: Transformation[]) {
    const tokenManager = this.editor.getTokenManager();
    const cursor = this.editor.getCursor();
    const appliedTransformations = tokenManager.applyTransformations(transformations);
    const lastTransformation = transformations[transformations.length - 1];
    let cursorAnchor = cursor.getAnchor();
    let cursorHead = cursor.getHead();
    transformations.forEach(transformation => {
      const transformationCursorAnchor = transformation.getCursorAnchor();
      const transformationCursorHead = transformation.getCursorHead();
      if (transformationCursorAnchor !== null) {
        cursorAnchor = transformationCursorAnchor;
      }
      if (transformationCursorHead !== null) {
        cursorHead = transformationCursorHead;
      }
    });
    cursor.set(cursorAnchor, cursorHead, lastTransformation.getCursorLockLeft());
    return appliedTransformations;
  }
}

export default Transformer;
