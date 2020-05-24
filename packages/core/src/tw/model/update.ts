import { IModelRoot } from './root';
import { ISlice } from './slice';

export interface IUpdate {
    apply(root: IModelRoot<any>): IUpdateResult;
}

export interface IUpdateResult {
    readonly update: IUpdate;
}

export class Replace implements IUpdate {
    constructor(readonly from: number, readonly to: number, readonly slice: ISlice) {}

    apply(root: IModelRoot<any>): IUpdateResult {
        // TODO
        return new ReplaceResult(this);
    }
}

export class ReplaceResult implements IUpdateResult {
    constructor(readonly update: IUpdate) {}
}
