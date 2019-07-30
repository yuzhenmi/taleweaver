import StateUpdatedEvent from '../dispatch/events/StateUpdatedEvent';
import Editor from '../Editor';
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

    constructor(editor: Editor, markup: string) {
        this.editor = editor;
        const tokenizer = new Tokenizer(markup);
        this.tokens = tokenizer.getTokens();
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
        const {
            beforeFrom,
            beforeTo,
            afterFrom,
            afterTo,
        } = this.findTransformedRange(appliedTransformations);
        this.editor.getDispatcher().dispatch(new StateUpdatedEvent(
            beforeFrom,
            beforeTo,
            afterFrom,
            afterTo,
        ));
        return appliedTransformations;
    }

    unapplyTransformations(appliedTransformations: AppliedTransformation[]) {
        if (!this.initialized) {
            throw new Error('Error unapplying transformation, state engine has not been initialized.');
        }
        appliedTransformations.slice().reverse().forEach(appliedTransformation => this.unapplyTransformation(appliedTransformation));
        const {
            beforeFrom,
            beforeTo,
            afterFrom,
            afterTo,
        } = this.findTransformedRange(appliedTransformations);
        this.editor.getDispatcher().dispatch(new StateUpdatedEvent(
            beforeFrom,
            beforeTo,
            afterFrom,
            afterTo,
        ));
    }

    protected applyTransformation(transformation: Transformation): AppliedTransformation {
        const cursor = this.editor.getCursor();
        const appliedTransformation = new AppliedTransformation(
            transformation,
            cursor.getAnchor(),
            cursor.getHead(),
            cursor.getLeftLock(),
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
        });
        return {
            beforeFrom: beforeFrom!,
            beforeTo: beforeTo!,
            afterFrom: afterFrom!,
            afterTo: afterTo!,
        };
    }
}
