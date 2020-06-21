import { IConfigService } from '../config/service';
import { IDidApplyTransformationEvent, ITransformService } from '../transform/service';
import { ITransformationResult } from '../transform/transformation';
import { HistoryAction, IHistoryAction } from './action';

export interface IHistoryState {
    undo(): void;
    redo(): void;
}

export class HistoryState implements IHistoryState {
    protected maxCollapseDuration: number;
    protected collapseThreshold: number;
    protected actions: IHistoryAction[] = [];
    protected offset: number = -1;

    constructor(protected configService: IConfigService, protected transformService: ITransformService) {
        const config = configService.getConfig();
        this.maxCollapseDuration = config.history.maxCollapseDuration;
        this.collapseThreshold = config.history.collapseThreshold;
        transformService.onDidApplyTransformation(this.handleDidApplyTransformation);
    }

    undo() {
        const action = this.consumeNextUndoableAction();
        if (!action) {
            return;
        }
        const results = action.transformationResults;
        if (results.length === 0) {
            return;
        }
        for (let n = results.length - 1; n >= 0; n--) {
            const result = results[n];
            this.transformService.applyTransformation(result.reverseTransformation);
        }
    }

    redo() {
        const action = this.consumeNextRedoableAction();
        if (!action) {
            return;
        }
        action.transformationResults.forEach((result) =>
            this.transformService.applyTransformation(result.transformation),
        );
    }

    protected consumeNextUndoableAction() {
        if (this.offset < 0) {
            return undefined;
        }
        const action = this.actions[this.offset];
        this.offset--;
        return action;
    }

    protected consumeNextRedoableAction() {
        if (this.offset >= this.actions.length - 1) {
            return undefined;
        }
        this.offset++;
        return this.actions[this.offset];
    }

    protected handleDidApplyTransformation = (event: IDidApplyTransformationEvent) => {
        const { result } = event;
        // Do not record undo
        if (
            this.offset + 1 < this.actions.length &&
            this.actions[this.offset + 1].transformationResults.some(
                (tnResult) => tnResult.reverseTransformation === result.transformation,
            )
        ) {
            return;
        }
        // Do not record redo
        if (
            this.offset >= 0 &&
            this.actions[this.offset].transformationResults.some(
                (tnResult) => tnResult.transformation === result.transformation,
            )
        ) {
            return;
        }
        if (this.offset < 0) {
            this.recordToNewAction(result);
            return;
        }
        const currentItem = this.actions[this.offset];
        const now = Date.now();
        if (
            now - currentItem.beganAt < this.maxCollapseDuration &&
            now - currentItem.endedAt < this.collapseThreshold
        ) {
            this.recordToLastAction(result);
        } else {
            this.recordToNewAction(result);
        }
    };

    protected recordToNewAction(result: ITransformationResult) {
        if (result.changeResults.length === 0) {
            return;
        }
        if (this.offset < this.actions.length - 1) {
            this.actions.splice(this.offset + 1, this.actions.length - 1 - this.offset);
        }
        const action = new HistoryAction();
        action.recordTransformationResult(result);
        this.actions.push(action);
        this.offset++;
    }

    protected recordToLastAction(result: ITransformationResult) {
        const action = this.actions[this.offset];
        if (!action) {
            throw new Error('Error recording applied transformation, history is empty.');
        }
        if (this.offset < this.actions.length - 1) {
            this.actions.splice(this.offset + 1, this.actions.length - 1 - this.offset);
        }
        action.recordTransformationResult(result);
    }
}
