import { IComponentService } from '../component/service';
import { ICursorService, ICursorState } from '../cursor/service';
import { ILayoutService } from '../layout/service';
import { IMapping } from '../model/change/mapping';
import { IModelRoot } from '../model/root';
import { IRenderService } from '../render/service';
import { IChange, IChangeResult } from './change';

export interface ITransformation {
    apply(
        root: IModelRoot<any>,
        componentService: IComponentService,
        cursorService: ICursorService,
        renderService: IRenderService,
        layoutService: ILayoutService,
    ): ITransformationResult;
}

export interface ITransformationResult {
    readonly transformation: ITransformation;
    readonly changeResults: IChangeResult[];
}

export class Transformation implements ITransformation {
    constructor(protected changes: IChange[], protected keepLeftLock = false) {}

    apply(
        root: IModelRoot<any>,
        componentService: IComponentService,
        cursorService: ICursorService,
        renderService: IRenderService,
        layoutService: ILayoutService,
    ): ITransformationResult {
        const changeResults = this.applyChanges(root, componentService, cursorService, renderService);
        if (!this.keepLeftLock) {
            const { node: line, offset: lineOffset } = layoutService
                .resolvePosition(cursorService.getState().head)
                .atLineDepth();
            cursorService.setLeftLock(line.resolveBoundingBoxes(lineOffset, lineOffset).boundingBoxes[0].left);
        }
        return new TransformationResult(this, changeResults);
    }

    protected applyChanges(
        root: IModelRoot<any>,
        componentService: IComponentService,
        cursorService: ICursorService,
        renderService: IRenderService,
    ) {
        const changeResults: IChangeResult[] = [];
        const mappings: IMapping[] = [];
        let cursorState = cursorService.getState();
        this.changes.forEach((change) => {
            let changeResult: IChangeResult;
            switch (change.type) {
                case 'model':
                    const modelCursorState = this.convertCursorStateToModelOffsets(cursorState, renderService);
                    changeResult = change.apply(root, mappings, componentService);
                    mappings.push(changeResult.mapping);
                    cursorState = this.mapCursorState(modelCursorState, changeResult.mapping, renderService);
                    break;
                case 'cursor':
                    changeResult = change.apply(cursorState, mappings);
                    break;
                default:
                    throw new Error('Unknown change type.');
            }
            changeResults.push(changeResult);
        });
        return changeResults;
    }

    protected convertCursorStateToModelOffsets(cursorState: ICursorState, renderService: IRenderService) {
        const anchor = renderService.convertOffsetToModelOffset(cursorState.anchor);
        const head = renderService.convertOffsetToModelOffset(cursorState.head);
        return { anchor, head };
    }

    protected mapCursorState(modelCursorState: ICursorState, mapping: IMapping, renderService: IRenderService) {
        const modelAnchor = mapping.map(modelCursorState.anchor);
        const modelHead = mapping.map(modelCursorState.head);
        const anchor = renderService.convertModelOffsetToOffset(modelAnchor);
        const head = renderService.convertModelOffsetToOffset(modelHead);
        return { anchor, head };
    }
}

export class TransformationResult implements ITransformationResult {
    constructor(readonly transformation: ITransformation, readonly changeResults: IChangeResult[]) {}
}
