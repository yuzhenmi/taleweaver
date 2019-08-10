import Editor from '../Editor';
import StateUpdatedEvent from '../events/StateUpdatedEvent';
import AppliedTransformation from '../transform/AppliedTransformation';
import { OffsetAdjustment } from '../transform/Operation';
import Delete, { AppliedDelete } from '../transform/operations/Delete';
import Insert, { AppliedInsert } from '../transform/operations/Insert';
import Transformation from '../transform/Transformation';
import CloseTagToken from './CloseTagToken';
import OpenTagToken from './OpenTagToken';
import Token from './Token';
import Tokenizer from './Tokenizer';

export default class StateEngine {
    protected editor: Editor;
    protected initialized: boolean = false;
    protected tokens: Token[] = [
        new OpenTagToken('Doc', 'Doc', {}),
        new CloseTagToken(),
    ];

    constructor(editor: Editor) {
        this.editor = editor;
    }

    initialize(markup: string) {
        if (this.initialized) {
            throw new Error('Error initializing state engine, state engine has already been initialized.');
        }
        const tokenizer = new Tokenizer(markup);
        this.tokens = tokenizer.getTokens();
        this.editor.getDispatcher().dispatch(new StateUpdatedEvent(
            0,
            1,
            0,
            this.tokens.length,
        ));
        this.initialized = true;
    }

    getTokens(): Token[] {
        return this.tokens;
    }

    applyTransformations(transformations: Transformation[]): AppliedTransformation[] {
        if (!this.initialized) {
            throw new Error('Error applying transformation, state engine has not been initialized.');
        }
        const appliedTransformations = transformations.map(transformation => this.applyTransformation(transformation));
        const transformedRange = this.findTransformedRange(appliedTransformations);
        if (transformedRange) {
            this.editor.getDispatcher().dispatch(new StateUpdatedEvent(
                transformedRange.beforeFrom,
                transformedRange.beforeTo,
                transformedRange.afterFrom,
                transformedRange.afterTo,
            ));
        }
        return appliedTransformations;
    }

    unapplyTransformations(appliedTransformations: AppliedTransformation[]) {
        if (!this.initialized) {
            throw new Error('Error unapplying transformation, state engine has not been initialized.');
        }
        appliedTransformations.slice().reverse().forEach(appliedTransformation => this.unapplyTransformation(appliedTransformation));
        const transformedRange = this.findTransformedRange(appliedTransformations);
        if (transformedRange) {
            this.editor.getDispatcher().dispatch(new StateUpdatedEvent(
                transformedRange.beforeFrom,
                transformedRange.beforeTo,
                transformedRange.afterFrom,
                transformedRange.afterTo,
            ));
        }
    }

    protected applyTransformation(transformation: Transformation): AppliedTransformation {
        const cursorService = this.editor.getCursorService();
        const appliedTransformation = new AppliedTransformation(
            transformation,
            cursorService.getAnchor(),
            cursorService.getHead(),
            cursorService.getLeftLock(),
        );
        const cursorAnchor = transformation.getCursorAnchor();
        const cursorHead = transformation.getCursorHead();
        cursorService.set(
            cursorAnchor === null ? cursorService.getAnchor() : cursorAnchor,
            cursorHead === null ? cursorService.getHead() : cursorHead,
            transformation.getCursorLockLeft(),
        );
        const operations = transformation.getOperations();
        if (operations.length === 0) {
            return appliedTransformation;
        }
        const offsetAdjustments: OffsetAdjustment[] = [];
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

    protected unapplyTransformation(appliedTransformation: AppliedTransformation) {
        appliedTransformation.getOperations().slice().reverse().forEach(appliedOperation => {
            if (appliedOperation instanceof AppliedInsert) {
                this.tokens.splice(appliedOperation.getAt(), appliedOperation.getTokens().length);
            } else if (appliedOperation instanceof AppliedDelete) {
                this.tokens.splice(appliedOperation.getAt(), 0, ...appliedOperation.getTokens());
            } else {
                throw new Error('Unknown applied transformation operation encountered.');
            }
        });
    }

    protected findTransformedRange(appliedTransformations: AppliedTransformation[]) {
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
            return null;
        }
        return {
            beforeFrom: beforeFrom!,
            beforeTo: beforeTo!,
            afterFrom: afterFrom!,
            afterTo: afterTo!,
        };
    }
}
