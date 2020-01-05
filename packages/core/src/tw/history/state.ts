import { IConfigService } from '../config/service';
import { IStateService } from '../state/service';
import { IDidApplyTransformation } from '../state/state';
import { IAppliedTransformation } from '../state/transformation';
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

    constructor(protected configService: IConfigService, protected stateService: IStateService) {
        const config = configService.getConfig();
        this.maxCollapseDuration = config.history.maxCollapseDuration;
        this.collapseThreshold = config.history.collapseThreshold;
        stateService.onDidApplyTransformation(this.handleDidApplyTransformation);
    }

    undo() {
        const action = this.consumeNextUndoableAction();
        if (!action) {
            return;
        }
        const appliedTransformations = action.getAppliedTransformations();
        if (appliedTransformations.length === 0) {
            return;
        }
        this.stateService.unapplyTransformations(appliedTransformations);
    }

    redo() {
        const action = this.consumeNextRedoableAction();
        if (!action) {
            return;
        }
        const transformations = action
            .getAppliedTransformations()
            .map(appliedTransformation => appliedTransformation.getOriginalTransformation());
        this.stateService.applyTransformations(transformations);
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

    protected recordAppliedTransformationToNewAction(appliedTransformation: IAppliedTransformation) {
        if (appliedTransformation.getOperations().length === 0) {
            return;
        }
        if (this.offset < this.actions.length - 1) {
            this.actions.splice(this.offset + 1, this.actions.length - 1 - this.offset);
        }
        const action = new HistoryAction();
        action.recordAppliedTransformation(appliedTransformation);
        this.actions.push(action);
        this.offset++;
    }

    protected recordAppliedTransformationToLastAction(appliedTransformation: IAppliedTransformation) {
        const action = this.actions[this.offset];
        if (!action) {
            throw new Error('Error recording applied transformation, history is empty.');
        }
        if (this.offset < this.actions.length - 1) {
            this.actions.splice(this.offset + 1, this.actions.length - 1 - this.offset);
        }
        action.recordAppliedTransformation(appliedTransformation);
    }

    protected handleDidApplyTransformation = (event: IDidApplyTransformation) => {
        const { transformation, appliedTransformation } = event;
        // Do not record applied transformation if originated from redo
        if (
            this.offset >= 0 &&
            this.actions[this.offset]
                .getAppliedTransformations()
                .some(appliedTn => appliedTn.getOriginalTransformation() === transformation)
        ) {
            return;
        }
        if (this.offset < 0) {
            this.recordAppliedTransformationToNewAction(appliedTransformation);
            return;
        }
        const currentItem = this.actions[this.offset];
        const now = Date.now();
        if (
            now - currentItem.getBeganAt() < this.maxCollapseDuration &&
            now - currentItem.getEndedAt() < this.collapseThreshold
        ) {
            this.recordAppliedTransformationToLastAction(appliedTransformation);
        } else {
            this.recordAppliedTransformationToNewAction(appliedTransformation);
        }
    };
}
