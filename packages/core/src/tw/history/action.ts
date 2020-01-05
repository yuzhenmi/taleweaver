import { IAppliedTransformation } from '../state/transformation';

export interface IHistoryAction {
    getBeganAt(): number;
    getEndedAt(): number;
    recordAppliedTransformation(appliedTransformation: IAppliedTransformation): void;
    getAppliedTransformations(): IAppliedTransformation[];
}

export class HistoryAction implements IHistoryAction {
    protected beganAt: number;
    protected endedAt: number;
    protected appliedTransformations: IAppliedTransformation[] = [];

    constructor() {
        this.beganAt = Date.now();
        this.endedAt = this.beganAt;
    }

    getBeganAt() {
        return this.beganAt;
    }

    getEndedAt() {
        return this.endedAt;
    }

    recordAppliedTransformation(appliedTransformation: IAppliedTransformation) {
        this.appliedTransformations.push(appliedTransformation);
        this.endedAt = Date.now();
    }

    getAppliedTransformations() {
        return this.appliedTransformations;
    }
}
