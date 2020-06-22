import { ITransformationResult } from '../transform/transformation';

export interface IHistoryAction {
    readonly beganAt: number;
    readonly endedAt: number;
    readonly transformationResults: ITransformationResult[];

    recordTransformationResult(transformationResult: ITransformationResult): void;
}

export class HistoryAction implements IHistoryAction {
    protected internalEndedAt: number;
    protected internalTransformationResults: ITransformationResult[] = [];

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

    recordTransformationResult(transformationResult: ITransformationResult) {
        this.transformationResults.push(transformationResult);
        this.internalEndedAt = Date.now();
    }
}
