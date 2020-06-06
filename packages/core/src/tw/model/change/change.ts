import { IModelRoot } from '../root';

export interface IChange {
    apply(root: IModelRoot<any>): IChangeResult;
}

export interface IChangeResult {
    readonly change: IChange;
    readonly reverseChange: IChange;
}
