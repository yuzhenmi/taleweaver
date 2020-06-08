import { IComponentService } from '../component/service';
import { ICursorService } from '../cursor/service';
import { IChange, IChangeResult } from './change/change';
import { IMapping } from './change/mapping';
import { IModelRoot } from './root';

export interface ITransformation {
    readonly changes: IChange[];
    readonly cursorAnchor: number | null;
    readonly cursorHead: number | null;
    readonly cursorLeftLock: number | null;

    apply(
        root: IModelRoot<any>,
        componentService: IComponentService,
        cursorService: ICursorService,
    ): ITransformationResult;
}

export interface ICursorResult {
    originalAnchor: number;
    originalHead: number;
    originalLeftLock: number | null;
}

export interface ITransformationResult {
    readonly transformation: ITransformation;
    readonly changeResults: IChangeResult[];
    readonly cursorResult: ICursorResult;
}

export class Transformation implements ITransformation {
    constructor(
        readonly changes: IChange[],
        readonly cursorAnchor: number | null,
        readonly cursorHead: number | null,
        readonly cursorLeftLock: number | null,
    ) {}

    apply(
        root: IModelRoot<any>,
        componentService: IComponentService,
        cursorService: ICursorService,
    ): ITransformationResult {
        const [changeResults, mappings] = this.applyChanges(root, componentService);
        const cursorResult = this.applyCursor(cursorService, mappings);
        return new TransformationResult(this, changeResults, cursorResult);
    }

    protected applyChanges(root: IModelRoot<any>, componentService: IComponentService): [IChangeResult[], IMapping[]] {
        const changeResults: IChangeResult[] = [];
        const mappings: IMapping[] = [];
        this.changes.forEach((change) => {
            const changeResult = change.apply(root, mappings, componentService);
            changeResults.push(changeResult);
            mappings.push(changeResult.mapping);
        });
        return [changeResults, mappings];
    }

    protected applyCursor(cursorService: ICursorService, mappings: IMapping[]): ICursorResult {
        const {
            anchor: originalAnchor,
            head: originalHead,
            leftLock: originalLeftLock,
        } = cursorService.getCursorState();
        const newCursorState = { ...cursorService.getCursorState() };
        if (this.cursorAnchor) {
            newCursorState.anchor = mappings.reduce((anchor, mapping) => mapping.map(anchor), this.cursorAnchor);
        }
        if (this.cursorHead) {
            newCursorState.head = mappings.reduce((head, mapping) => mapping.map(head), this.cursorHead);
        }
        if (this.cursorLeftLock) {
            newCursorState.leftLock = mappings.reduce(
                (leftLock, mapping) => mapping.map(leftLock),
                this.cursorLeftLock,
            );
        }
        cursorService.setCursorState(newCursorState);
        return { originalAnchor, originalHead, originalLeftLock };
    }
}

export class TransformationResult implements ITransformationResult {
    constructor(
        readonly transformation: ITransformation,
        readonly changeResults: IChangeResult[],
        readonly cursorResult: ICursorResult,
    ) {}
}
