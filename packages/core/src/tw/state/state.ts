import { ICursorService } from 'tw/cursor/service';
import { EventEmitter, IEventEmitter } from 'tw/event/emitter';
import { IEventListener, IOnEvent } from 'tw/event/listener';
import { IToken } from 'tw/state//token';
import { Tokenizer } from 'tw/state/tokenizer';
import {
    AppliedDelete,
    AppliedInsert,
    AppliedTransformation,
    Delete,
    IAppliedTransformation,
    Insert,
    IOffsetAdjustment,
    ITransformation,
} from 'tw/state/transformation';

export interface IDidUpdateStateEvent {
    readonly beforeFrom: number;
    readonly beforeTo: number;
    readonly afterFrom: number;
    readonly afterTo: number;
}

export interface IState {
    onDidUpdateState: IOnEvent<IDidUpdateStateEvent>;
    getTokens(): IToken[];
    applyTransformations(transformations: ITransformation[]): IAppliedTransformation[];
    unapplyTransformations(appliedTransformations: IAppliedTransformation[]): void;
}

export class State implements IState {
    protected tokens: IToken[];
    protected didUpdateStateEventEmitter: IEventEmitter<IDidUpdateStateEvent> = new EventEmitter();

    constructor(protected cursorService: ICursorService, initialMarkup: string) {
        const tokenizer = new Tokenizer();
        this.tokens = tokenizer.tokenize(initialMarkup);
    }

    onDidUpdateState(listener: IEventListener<IDidUpdateStateEvent>) {
        this.didUpdateStateEventEmitter.on(listener);
    }

    getTokens(): IToken[] {
        return this.tokens;
    }

    applyTransformations(transformations: ITransformation[]): IAppliedTransformation[] {
        this.assertInitialized();
        const appliedTransformations = transformations.map(transformation => this.applyTransformation(transformation));
        const transformedRange = this.findTransformedRange(appliedTransformations);
        if (transformedRange) {
            this.didUpdateStateEventEmitter.emit({
                beforeFrom: transformedRange.beforeFrom,
                beforeTo: transformedRange.beforeTo,
                afterFrom: transformedRange.afterFrom,
                afterTo: transformedRange.afterTo,
            });
        }
        return appliedTransformations;
    }

    unapplyTransformations(appliedTransformations: IAppliedTransformation[]) {
        this.assertInitialized();
        appliedTransformations
            .slice()
            .reverse()
            .forEach(appliedTransformation => this.unapplyTransformation(appliedTransformation));
        const transformedRange = this.findTransformedRange(appliedTransformations);
        if (transformedRange) {
            this.didUpdateStateEventEmitter.emit({
                beforeFrom: transformedRange.beforeFrom,
                beforeTo: transformedRange.beforeTo,
                afterFrom: transformedRange.afterFrom,
                afterTo: transformedRange.afterTo,
            });
        }
    }

    protected applyTransformation(transformation: ITransformation): IAppliedTransformation {
        const cursorState = this.cursorService.getCursorState();
        const appliedTransformation = new AppliedTransformation(
            transformation,
            cursorState.anchor,
            cursorState.head,
            cursorState.leftLock,
        );
        const cursorAnchor = transformation.getCursorAnchor();
        const cursorHead = transformation.getCursorHead();
        this.cursorService.setCursorState({
            anchor: cursorAnchor === null ? cursorState.anchor : cursorAnchor,
            head: cursorHead === null ? cursorState.head : cursorHead,
            leftLock: transformation.getCursorLockLeft(),
        });
        const operations = transformation.getOperations();
        if (operations.length === 0) {
            return appliedTransformation;
        }
        const offsetAdjustments: IOffsetAdjustment[] = [];
        operations.forEach(unadjustedOperation => {
            const operation = unadjustedOperation.adjustOffset(offsetAdjustments);
            if (operation instanceof Insert) {
                this.tokens.splice(operation.getAt(), 0, ...operation.getTokens());
                const appliedOperation = new AppliedInsert(operation.getAt(), operation.getTokens());
                appliedTransformation.addOperation(appliedOperation);
            } else if (operation instanceof Delete) {
                const deletedTokens = this.tokens.splice(operation.getFrom(), operation.getTo() - operation.getFrom());
                const appliedOperation = new AppliedDelete(operation.getFrom(), deletedTokens);
                appliedTransformation.addOperation(appliedOperation);
            } else {
                throw new Error('Unknown transformation operation encountered.');
            }
            offsetAdjustments.push(operation.getOffsetAdjustment());
        });
        return appliedTransformation;
    }

    protected unapplyTransformation(appliedTransformation: IAppliedTransformation) {
        appliedTransformation
            .getOperations()
            .slice()
            .reverse()
            .forEach(appliedOperation => {
                if (appliedOperation instanceof AppliedInsert) {
                    this.tokens.splice(appliedOperation.getAt(), appliedOperation.getTokens().length);
                } else if (appliedOperation instanceof AppliedDelete) {
                    this.tokens.splice(appliedOperation.getAt(), 0, ...appliedOperation.getTokens());
                } else {
                    throw new Error('Unknown applied transformation operation encountered.');
                }
            });
    }

    protected findTransformedRange(appliedTransformations: IAppliedTransformation[]) {
        let beforeFrom: number | undefined = undefined;
        let beforeTo: number | undefined = undefined;
        let afterFrom: number | undefined = undefined;
        let afterTo: number | undefined = undefined;
        appliedTransformations.forEach(appliedTransformation => {
            const transformedRange = appliedTransformation.getTransformedRange();
            if (transformedRange) {
                if (beforeFrom === undefined || transformedRange.beforeFrom < beforeFrom) {
                    beforeFrom = transformedRange.beforeFrom;
                }
                if (beforeTo === undefined || transformedRange.beforeTo > beforeTo) {
                    beforeTo = transformedRange.beforeTo;
                }
                if (afterFrom === undefined || transformedRange.afterFrom < afterFrom) {
                    afterFrom = transformedRange.afterFrom;
                }
                if (afterTo === undefined || transformedRange.afterTo < afterTo) {
                    afterTo = transformedRange.afterTo;
                }
            }
        });
        if (beforeFrom === undefined) {
            return undefined;
        }
        return {
            beforeFrom: beforeFrom!,
            beforeTo: beforeTo!,
            afterFrom: afterFrom!,
            afterTo: afterTo!,
        };
    }

    protected assertInitialized() {
        if (!this.tokens) {
            throw new Error('State is not initialized.');
        }
    }
}
