import { IModelRoot } from './root';
import { IUpdate, IUpdateResult } from './update';

export interface ITransformation {
    readonly updates: IUpdate[];
    readonly cursorAnchor: number | null;
    readonly cursorHead: number | null;
    readonly cursorLeftLock: number | null;

    apply(root: IModelRoot<any>): ITransformationResult;
}

export interface ITransformationResult {
    readonly transformation: ITransformation;
    readonly updateResults: IUpdateResult[];
    readonly beforeCursorAnchor: number;
    readonly beforeCursorHead: number;
    readonly beforeCursorLeftLock: number | null;
}

export class Transformation implements ITransformation {
    constructor(
        readonly updates: IUpdate[],
        readonly cursorAnchor: number | null,
        readonly cursorHead: number | null,
        readonly cursorLeftLock: number | null,
    ) {}

    apply(root: IModelRoot<any>): ITransformationResult {
        const updateResults = this.updates.map((update) => update.apply(root));
        // TODO: Build result properly
        return new TransformationResult(this, updateResults, 0, 0, 0);
    }
}

export class TransformationResult implements ITransformationResult {
    constructor(
        readonly transformation: ITransformation,
        readonly updateResults: IUpdateResult[],
        readonly beforeCursorAnchor: number,
        readonly beforeCursorHead: number,
        readonly beforeCursorLeftLock: number | null,
    ) {}
}
