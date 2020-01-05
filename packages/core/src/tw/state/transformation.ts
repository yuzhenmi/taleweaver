import { IToken } from './token';

export interface IOffsetAdjustment {
    at: number;
    delta: number;
}

export interface IOperation {
    getOffsetAdjustment(): IOffsetAdjustment;
    adjustOffset(adjustments: IOffsetAdjustment[]): IOperation;
}

export interface IAppliedOperation {}

export interface ITransformation {
    addOperation(operation: IOperation): void;
    getOperations(): IOperation[];
    setCursor(position: number): void;
    setCursorHead(position: number): void;
    setCursorLockLeft(position: number): void;
    getCursorAnchor(): number | null;
    getCursorHead(): number | null;
    getCursorLockLeft(): number | null;
}

export interface ITransformedRange {
    readonly beforeFrom: number;
    readonly beforeTo: number;
    readonly afterFrom: number;
    readonly afterTo: number;
}

export interface IAppliedTransformation {
    addOperation(operation: IAppliedOperation): void;
    getOperations(): IAppliedOperation[];
    getOriginalTransformation(): ITransformation;
    getOriginalCursorAnchor(): number;
    getOriginalCursorHead(): number;
    getOriginalCursorLockLeft(): number | null;
    getTransformedRange(): ITransformedRange | undefined;
}

export class InsertOperation implements IOperation {
    constructor(protected at: number, protected tokens: IToken[]) {}

    getOffsetAdjustment(): IOffsetAdjustment {
        return {
            at: this.at,
            delta: this.tokens.length,
        };
    }

    adjustOffset(adjustments: IOffsetAdjustment[]) {
        let at = this.at;
        adjustments.forEach(adjustment => {
            if (at >= adjustment.at) {
                at += adjustment.delta;
            }
        });
        return new InsertOperation(at, this.tokens);
    }

    getAt() {
        return this.at;
    }

    getTokens() {
        return this.tokens;
    }
}

export class DeleteOperation implements IOperation {
    constructor(protected from: number, protected to: number) {}

    getOffsetAdjustment() {
        return {
            at: this.to,
            delta: this.from - this.to,
        };
    }

    adjustOffset(adjustments: IOffsetAdjustment[]) {
        let from = this.from;
        let to = this.to;
        adjustments.forEach(adjustment => {
            if (from >= adjustment.at) {
                from += adjustment.delta;
            }
            if (to >= adjustment.at) {
                to += adjustment.delta;
            }
        });
        return new DeleteOperation(from, to);
    }

    getFrom() {
        return this.from;
    }

    getTo() {
        return this.to;
    }
}

export class AppliedInsertOperation implements IAppliedOperation {
    constructor(protected at: number, protected tokens: IToken[]) {}

    getAt() {
        return this.at;
    }

    getTokens() {
        return this.tokens;
    }
}

export class AppliedDeleteOperation implements IAppliedOperation {
    constructor(protected at: number, protected tokens: IToken[]) {}

    getAt() {
        return this.at;
    }

    getTokens() {
        return this.tokens;
    }
}

export class Transformation implements ITransformation {
    protected operations: IOperation[] = [];
    protected cursorAnchor: number | null = null;
    protected cursorHead: number | null = null;
    protected cursorLockLeft: number | null = null;

    addOperation(operation: IOperation) {
        this.operations.push(operation);
    }

    getOperations() {
        return this.operations;
    }

    setCursor(at: number) {
        this.cursorAnchor = at;
        this.cursorHead = at;
    }

    setCursorHead(cursorHead: number) {
        this.cursorHead = cursorHead;
    }

    setCursorLockLeft(cursorLockLeft: number) {
        this.cursorLockLeft = cursorLockLeft;
    }

    getCursorAnchor() {
        return this.cursorAnchor;
    }

    getCursorHead() {
        return this.cursorHead;
    }

    getCursorLockLeft() {
        return this.cursorLockLeft;
    }
}

export class AppliedTransformation implements IAppliedTransformation {
    protected operations: IAppliedOperation[] = [];
    protected beforeFrom?: number;
    protected beforeTo?: number;
    protected afterFrom?: number;
    protected afterTo?: number;

    constructor(
        protected originalTransformation: ITransformation,
        protected originalCursorHead: number,
        protected originalCursorAnchor: number,
        protected originalCursorLockLeft: number | null,
    ) {}

    addOperation(operation: IAppliedOperation) {
        this.operations.push(operation);
        let beforeFrom: number;
        let beforeTo: number;
        let afterFrom: number;
        let afterTo: number;
        if (operation instanceof AppliedInsertOperation) {
            const at = operation.getAt();
            const insertedTokens = operation.getTokens();
            beforeFrom = at;
            beforeTo = at;
            afterFrom = at;
            afterTo = at + insertedTokens.length;
        } else if (operation instanceof AppliedDeleteOperation) {
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
            return undefined;
        }
        return {
            beforeFrom: this.beforeFrom!,
            beforeTo: this.beforeTo!,
            afterFrom: this.afterFrom!,
            afterTo: this.afterTo!,
        };
    }
}
