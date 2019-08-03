import Editor from '../Editor';
import AppliedTransformation from '../transform/AppliedTransformation';
import Transformation from '../transform/Transformation';
import StateEngine from './StateEngine';

export default class StateService {
    protected editor: Editor;
    protected stateEngine: StateEngine;

    constructor(editor: Editor) {
        this.editor = editor;
        this.stateEngine = new StateEngine(editor);
    }

    initialize(markup: string) {
        this.stateEngine.initialize(markup);
    }

    getTokens() {
        return this.stateEngine.getTokens();
    }

    applyTransformation(transformation: Transformation) {
        return this.applyTransformations([transformation])[0];
    }

    applyTransformations(transformations: Transformation[]) {
        return this.stateEngine.applyTransformations(transformations);
    }

    unapplyTransformations(appliedTransformations: AppliedTransformation[]) {
        this.stateEngine.unapplyTransformations(appliedTransformations);
    }
}
