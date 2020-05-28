import { IModelRoot } from './root';
import { ISlice } from './slice';

export interface IChange {
    apply(root: IModelRoot<any>): IChangeResult;
}

export interface IChangeResult {
    readonly change: IChange;
}

export class Replace implements IChange {
    constructor(readonly from: number, readonly to: number, readonly slice: ISlice) {}

    apply(root: IModelRoot<any>): IChangeResult {
        const fromPosition = root.resolvePosition(this.from);
        const toPosition = root.resolvePosition(this.to);
        if (this.slice.open >= fromPosition.depth || this.slice.open >= toPosition.depth) {
            throw new Error('Slice does not fit in range.');
        }
        // TODO
        return new ReplaceResult(this);
    }
}

export class ReplaceResult implements IChangeResult {
    constructor(readonly change: IChange) {}
}
