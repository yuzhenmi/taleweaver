import { IChange, IChangeResult } from './change/change';
import { IModelRoot } from './root';

export interface ITransformation {
    readonly changes: IChange[];
    readonly cursorAnchor: number | null;
    readonly cursorHead: number | null;
    readonly cursorLeftLock: number | null;

    apply(root: IModelRoot<any>): ITransformationResult;
}

export interface ITransformationResult {
    readonly transformation: ITransformation;
    readonly changeResults: IChangeResult[];
    readonly beforeCursorAnchor: number;
    readonly beforeCursorHead: number;
    readonly beforeCursorLeftLock: number | null;
}

export class Transformation implements ITransformation {
    constructor(
        readonly changes: IChange[],
        readonly cursorAnchor: number | null,
        readonly cursorHead: number | null,
        readonly cursorLeftLock: number | null,
    ) {}

    apply(root: IModelRoot<any>): ITransformationResult {
        const changeResults = this.changes.map((change) => change.apply(root));
        // TODO: Build result properly
        return new TransformationResult(this, changeResults, 0, 0, 0);
    }
}

export class TransformationResult implements ITransformationResult {
    constructor(
        readonly transformation: ITransformation,
        readonly changeResults: IChangeResult[],
        readonly beforeCursorAnchor: number,
        readonly beforeCursorHead: number,
        readonly beforeCursorLeftLock: number | null,
    ) {}
}
