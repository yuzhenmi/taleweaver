import { ICursorService } from '../cursor/service';
import { ILayoutService } from '../layout/service';
import { IMapping } from '../model/change/mapping';
import { IModelService } from '../model/service';
import { IRenderService } from '../render/service';
import { IChange, IChangeResult } from './change';

export interface ITransformation {
    apply(
        modelService: IModelService,
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
        modelService: IModelService,
        cursorService: ICursorService,
        renderService: IRenderService,
        layoutService: ILayoutService,
    ): ITransformationResult {
        const changeResults = this.applyChanges(modelService, cursorService, renderService);
        if (cursorService.hasCursor() && !this.keepLeftLock) {
            const { node: line, offset: lineOffset } = layoutService
                .resolvePosition(cursorService.getCursor().head)
                .atLineDepth();
            cursorService.setLeftLock(line.resolveBoundingBoxes(lineOffset, lineOffset).boundingBoxes[0].left);
        }
        return new TransformationResult(this, changeResults);
    }

    protected applyChanges(modelService: IModelService, cursorService: ICursorService, renderService: IRenderService) {
        const changeResults: IChangeResult[] = [];
        const mappings: IMapping[] = [];
        let changes = [...this.changes];
        while (changes.length > 0) {
            const change = changes.shift()!;
            let changeResult: IChangeResult;
            switch (change.type) {
                case 'model':
                    const { modelAnchor, modelHead } = this.getCursorModelOffsets(cursorService, renderService);
                    changeResult = modelService.applyChange(change, mappings);
                    const mapping = changeResult.mapping;
                    mappings.push(mapping);
                    this.mapCursor(modelAnchor, modelHead, mapping, cursorService, renderService);
                    changes = changes.map((c) => c.map(mapping));
                    break;
                case 'cursor':
                    if (!cursorService.hasCursor()) {
                        continue;
                    }
                    changeResult = cursorService.applyChange(change);
                    break;
                default:
                    throw new Error('Unknown change type.');
            }
            changeResults.push(changeResult);
        }
        return changeResults;
    }

    protected getCursorModelOffsets(cursorService: ICursorService, renderService: IRenderService) {
        const cursor = cursorService.getCursor();
        const modelAnchor = renderService.convertOffsetToModelOffset(cursor.anchor);
        const modelHead = renderService.convertOffsetToModelOffset(cursor.head);
        return { modelAnchor, modelHead };
    }

    protected mapCursor(
        modelAnchor: number,
        modelHead: number,
        mapping: IMapping,
        cursorService: ICursorService,
        renderService: IRenderService,
    ) {
        const newModelAnchor = mapping.map(modelAnchor);
        const newModelHead = mapping.map(modelHead);
        const newAnchor = renderService.convertModelOffsetToOffset(newModelAnchor);
        const newHead = renderService.convertModelOffsetToOffset(newModelHead);
        cursorService.setCursor(newAnchor, newHead);
    }
}

export class TransformationResult implements ITransformationResult {
    constructor(readonly transformation: ITransformation, readonly changeResults: IChangeResult[]) {}
}
