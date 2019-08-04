import AppliedOperation from './AppliedOperation';
import { AppliedDelete } from './operations/Delete';
import { AppliedInsert } from './operations/Insert';
import Transformation from './Transformation';

export default class AppliedTransformation {
    protected originalTransformation: Transformation;
    protected operations: AppliedOperation[] = [];
    protected originalCursorHead: number;
    protected originalCursorAnchor: number;
    protected originalCursorLockLeft: number | null;
    protected beforeFrom?: number;
    protected beforeTo?: number;
    protected afterFrom?: number;
    protected afterTo?: number;

    constructor(
        originalTransformation: Transformation,
        originalCursorHead: number,
        originalCursorAnchor: number,
        originalCursorLockLeft: number | null,
    ) {
        this.originalTransformation = originalTransformation;
        this.originalCursorHead = originalCursorHead;
        this.originalCursorAnchor = originalCursorAnchor;
        this.originalCursorLockLeft = originalCursorLockLeft;
    }

    addOperation(operation: AppliedOperation) {
        this.operations.push(operation);
        let beforeFrom: number;
        let beforeTo: number;
        let afterFrom: number;
        let afterTo: number;
        if (operation instanceof AppliedInsert) {
            const at = operation.getAt();
            const insertedTokens = operation.getTokens();
            beforeFrom = at;
            beforeTo = at;
            afterFrom = at;
            afterTo = at + insertedTokens.length;
        } else if (operation instanceof AppliedDelete) {
            const at = operation.getAt();
            const deletedTokens = operation.getTokens();
            beforeFrom = at;
            beforeTo = at + deletedTokens.length;
            afterFrom = at;
            afterTo = at;
        } else {
            throw new Error('Invalid applied operation encountered.');
        }
        if (this.beforeFrom === undefined || beforeFrom < this.beforeFrom) {
            this.beforeFrom = beforeFrom;
        }
        if (this.beforeTo === undefined || beforeTo > this.beforeTo) {
            this.beforeTo = beforeTo;
        }
        if (this.afterFrom === undefined || afterFrom < this.afterFrom) {
            this.afterFrom = afterFrom;
        }
        if (this.afterTo === undefined || afterTo > this.afterTo) {
            this.afterTo = afterTo;
        }
    }

    getOperations() {
        return this.operations;
    }

    getOriginalTransformation() {
        return this.originalTransformation;
    }

    getOriginalCursorHead() {
        return this.originalCursorHead;
    }

    getOriginalCursorAnchor() {
        return this.originalCursorAnchor;
    }

    getOriginalCursorLockLeft() {
        return this.originalCursorLockLeft;
    }

    getTransformedRange() {
        if (this.beforeFrom === undefined) {
            return null;
        }
        return {
            beforeFrom: this.beforeFrom!,
            beforeTo: this.beforeTo!,
            afterFrom: this.afterFrom!,
            afterTo: this.afterTo!,
        };
    }
}
