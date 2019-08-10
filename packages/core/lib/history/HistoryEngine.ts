import Editor from '../Editor';
import AppliedTransformation from '../transform/AppliedTransformation';

class Change {
    protected timestamp: number;
    protected lastTimestamp: number;
    protected appliedTransformations: AppliedTransformation[] = [];

    constructor() {
        this.timestamp = Date.now();
        this.lastTimestamp = this.timestamp;
    }

    getTimestamp() {
        return this.timestamp;
    }

    getLastTimestamp() {
        return this.lastTimestamp;
    }

    addAppliedTransformation(appliedTransformation: AppliedTransformation) {
        this.appliedTransformations.push(appliedTransformation);
        this.lastTimestamp = Date.now();
    }

    getAppliedTransformations() {
        return this.appliedTransformations;
    }
}

const COLLAPSE_CHANGES_THRESHOLD = 500;
const COLLAPSE_CHANGES_MAX_DURATION = 2000;

export default class HistoryEngine {
    protected editor: Editor;
    protected changes: Change[] = [];
    protected pointer: number = -1;

    constructor(editor: Editor) {
        this.editor = editor;
    }

    undo() {
        const change = this.getNextChangeToUndo();
        if (!change) {
            return;
        }
        const stateService = this.editor.getStateService();
        const appliedTransformations = change.getAppliedTransformations();
        stateService.unapplyTransformations(appliedTransformations);
        const cursorService = this.editor.getCursorService();
        const firstAppliedTransformation = appliedTransformations[0];
        cursorService.set(
            firstAppliedTransformation.getOriginalCursorAnchor(),
            firstAppliedTransformation.getOriginalCursorHead(),
            firstAppliedTransformation.getOriginalCursorLockLeft(),
        );
    }

    redo() {
        const change = this.getNextChangeToRedo();
        if (!change) {
            return;
        }
    }

    protected recordAppliedTransformation(appliedTransformation: AppliedTransformation) {
        if (appliedTransformation.getOperations().length === 0) {
            return;
        }
        if (this.pointer < this.changes.length - 1) {
            this.changes.splice(this.pointer + 1, this.changes.length - 1 - this.pointer);
        }
        if (this.pointer < 0) {
            this.recordAppliedTransformationToNewItem(appliedTransformation);
            return;
        }
        const currentItem = this.changes[this.pointer];
        const now = Date.now();
        if (now - currentItem.getTimestamp() < COLLAPSE_CHANGES_MAX_DURATION && now - currentItem.getLastTimestamp() < COLLAPSE_CHANGES_THRESHOLD) {
            this.recordAppliedTransformationToLastItem(appliedTransformation);
        } else {
            this.recordAppliedTransformationToNewItem(appliedTransformation);
        }
    }

    protected recordAppliedTransformationToNewItem(appliedTransformation: AppliedTransformation) {
        const item = new Change();
        item.addAppliedTransformation(appliedTransformation);
        this.changes.push(item);
        this.pointer++;
    }

    protected recordAppliedTransformationToLastItem(appliedTransformation: AppliedTransformation) {
        const currentItem = this.changes[this.pointer];
        if (!currentItem) {
            throw new Error('Error recording applied transformation, history is empty.');
        }
        currentItem.addAppliedTransformation(appliedTransformation);
    }

    protected getNextChangeToUndo() {
        if (this.pointer < 0) {
            return null;
        }
        const change = this.changes[this.pointer];
        this.pointer -= 1;
        return change;
    }

    protected getNextChangeToRedo() {
        if (this.pointer > this.changes.length - 2) {
            return null;
        }
        this.pointer += 1;
        const change = this.changes[this.pointer];
        return change;
    }
}
