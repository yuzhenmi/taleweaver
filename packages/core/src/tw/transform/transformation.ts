import { IComponentService } from '../component/service';
import { ICursorService } from '../cursor/service';
import { IChange, IChangeResult } from '../model/change/change';
import { IMapping } from '../model/change/mapping';
import { IModelRoot } from '../model/root';
import { IRenderService } from '../render/service';

export interface ITransformation {
    apply(
        root: IModelRoot<any>,
        componentService: IComponentService,
        cursorService: ICursorService,
        renderService: IRenderService,
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
        protected changes: IChange[],
        protected cursorModelAnchor: number | null,
        protected cursorModelHead: number | null,
        protected cursorModelLeftLock: number | null,
    ) {}

    apply(
        root: IModelRoot<any>,
        componentService: IComponentService,
        cursorService: ICursorService,
        renderService: IRenderService,
    ): ITransformationResult {
        const [changeResults, mappings] = this.applyChanges(root, componentService);
        const cursorResult = this.applyCursor(cursorService, mappings, renderService);
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

    protected applyCursor(
        cursorService: ICursorService,
        mappings: IMapping[],
        renderService: IRenderService,
    ): ICursorResult {
        const {
            anchor: originalAnchor,
            head: originalHead,
            leftLock: originalLeftLock,
        } = cursorService.getCursorState();
        const newCursorState = { ...cursorService.getCursorState() };
        if (this.cursorModelAnchor !== null) {
            newCursorState.anchor = this.mapCursorOffset(this.cursorModelAnchor, mappings, renderService);
        }
        if (this.cursorModelHead !== null) {
            newCursorState.head = this.mapCursorOffset(this.cursorModelHead, mappings, renderService);
        }
        if (this.cursorModelLeftLock) {
            newCursorState.leftLock = this.mapCursorOffset(this.cursorModelLeftLock, mappings, renderService);
        }
        cursorService.setCursorState(newCursorState);
        return { originalAnchor, originalHead, originalLeftLock };
    }

    protected mapCursorOffset(modelOffset: number, mappings: IMapping[], renderService: IRenderService) {
        const mappedModelOffset = mappings.reduce(
            (mappedModelOffset, mapping) => mapping.map(mappedModelOffset),
            modelOffset,
        );
        return renderService.convertModelOffsetToOffset(mappedModelOffset);
    }
}

export class TransformationResult implements ITransformationResult {
    constructor(
        readonly transformation: ITransformation,
        readonly changeResults: IChangeResult[],
        readonly cursorResult: ICursorResult,
    ) {}
}
