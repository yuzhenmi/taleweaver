import Editor from '../Editor';
import AppliedTransformation from '../transform/AppliedTransformation';
import Transformation from '../transform/Transformation';
import StateEngine from './StateEngine';

export default class StateService {
  protected editor: Editor;
  protected stateEngine: StateEngine;

  constructor(editor: Editor, stateEngine: StateEngine) {
    this.editor = editor;
    this.stateEngine = stateEngine;
  }

  getTokens() {
    return this.stateEngine.getTokens();
  }

  applyTransformations(transformations: Transformation[]) {
    return this.stateEngine.applyTransformations(transformations);
  }

  unapplyTransformations(appliedTransformations: AppliedTransformation[]) {
    this.stateEngine.unapplyTransformations(appliedTransformations);
  }
}
