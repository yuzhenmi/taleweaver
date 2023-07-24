import { TransformationResult } from '../transform/transformation';

export class HistoryAction {
    protected internalEndedAt: number;
    protected internalTransformationResults: TransformationResult[] = [];

    readonly beganAt: number;

    constructor() {
        this.beganAt = Date.now();
        this.internalEndedAt = this.beganAt;
    }

    get endedAt() {
        return this.internalEndedAt;
    }

    get transformationResults() {
        return this.internalTransformationResults;
    }

    recordTransformationResult(transformationResult: TransformationResult) {
        this.transformationResults.push(transformationResult);
        this.internalEndedAt = Date.now();
    }
}
