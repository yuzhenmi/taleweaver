import { ICursorService } from '../cursor/service';
import { EventEmitter, IEventEmitter } from '../event/emitter';
import { IEventListener, IOnEvent } from '../event/listener';
import { IToken } from './/token';
import { Tokenizer } from './tokenizer';
import {
    AppliedDeleteOperation,
    AppliedInsertOperation,
    AppliedTransformation,
    DeleteOperation,
    IAppliedTransformation,
    InsertOperation,
    IOffsetAdjustment,
    ITransformation,
} from './transformation';

export interface IDidApplyTransformation {
    readonly transformation: ITransformation;
    readonly appliedTransformation: IAppliedTransformation;
}

export interface IDidUpdateStateEvent {
    readonly beforeFrom: number;
    readonly beforeTo: number;
    readonly afterFrom: number;
    readonly afterTo: number;
}

export interface IState {
    onDidApplyTransformation: IOnEvent<IDidApplyTransformation>;
    onDidUpdateState: IOnEvent<IDidUpdateStateEvent>;
    getTokens(): IToken[];
    applyTransformations(transformations: ITransformation[]): IAppliedTransformation[];
    unapplyTransformations(appliedTransformations: IAppliedTransformation[]): void;
}

export class State implements IState {
    protected tokens: IToken[];
    protected didApplyTransformationEventEmitter: IEventEmitter<IDidApplyTransformation> = new EventEmitter();
    protected didUpdateStateEventEmitter: IEventEmitter<IDidUpdateStateEvent> = new EventEmitter();

    constructor(protected cursorService: ICursorService, initialMarkup: string) {
        const tokenizer = new Tokenizer();
        this.tokens = tokenizer.tokenize(initialMarkup);
    }

    onDidApplyTransformation(listener: IEventListener<IDidApplyTransformation>) {
        this.didApplyTransformationEventEmitter.on(listener);
    }

    onDidUpdateState(listener: IEventListener<IDidUpdateStateEvent>) {
        this.didUpdateStateEventEmitter.on(listener);
    }

    getTokens(): IToken[] {
        return this.tokens;
    }

    applyTransformations(transformations: ITransformation[]): IAppliedTransformation[] {
        this.assertInitialized();
        const appliedTransformations = transformations.map(transformation => {
            const appliedTransformation = this.applyTransformation(transformation);
            this.didApplyTransformationEventEmitter.emit({ transformation, appliedTransformation });
            return appliedTransformation;
        });
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
        const operations = transformation.getOperations();
        const offsetAdjustments: IOffsetAdjustment[] = [];
        operations.forEach(unadjustedOperation => {
            const operation = unadjustedOperation.adjustOffset(offsetAdjustments);
            if (operation instanceof InsertOperation) {
                this.tokens.splice(operation.getAt(), 0, ...operation.getTokens());
                const appliedOperation = new AppliedInsertOperation(operation.getAt(), operation.getTokens());
                appliedTransformation.addOperation(appliedOperation);
            } else if (operation instanceof DeleteOperation) {
                const deletedTokens = this.tokens.splice(operation.getFrom(), operation.getTo() - operation.getFrom());
                const appliedOperation = new AppliedDeleteOperation(operation.getFrom(), deletedTokens);
                appliedTransformation.addOperation(appliedOperation);
            } else {
                throw new Error('Unknown transformation operation encountered.');
            }
            offsetAdjustments.push(operation.getOffsetAdjustment());
        });
        const cursorAnchor = transformation.getCursorAnchor();
        const cursorHead = transformation.getCursorHead();
        this.cursorService.setCursorState({
            anchor: cursorAnchor === null ? cursorState.anchor : cursorAnchor,
            head: cursorHead === null ? cursorState.head : cursorHead,
            leftLock: transformation.getCursorLockLeft(),
        });
        return appliedTransformation;
    }

    protected unapplyTransformation(appliedTransformation: IAppliedTransformation) {
        appliedTransformation
            .getOperations()
            .slice()
            .reverse()
            .forEach(appliedOperation => {
                if (appliedOperation instanceof AppliedInsertOperation) {
                    this.tokens.splice(appliedOperation.getAt(), appliedOperation.getTokens().length);
                } else if (appliedOperation instanceof AppliedDeleteOperation) {
                    this.tokens.splice(appliedOperation.getAt(), 0, ...appliedOperation.getTokens());
                } else {
                    throw new Error('Unknown applied transformation operation encountered.');
                }
            });
        this.cursorService.setCursorState({
            anchor: appliedTransformation.getOriginalCursorAnchor(),
            head: appliedTransformation.getOriginalCursorHead(),
            leftLock: appliedTransformation.getOriginalCursorLockLeft(),
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
