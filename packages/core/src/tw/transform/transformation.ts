import { ICursorService } from '../cursor/service';
import { atLine } from '../layout/position';
import { ILayoutService } from '../layout/service';
import { IChange, IChangeResult } from '../model/change/change';
import { IMapping } from '../model/change/mapping';
import { IModelPosition } from '../model/position';
import { IModelService } from '../model/service';
import { IRenderService } from '../render/service';

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
    readonly reverseTransformation: ITransformation;
}

export class Transformation implements ITransformation {
    constructor(
        protected changes: IChange[],
        protected modelCursorHead?: IModelPosition,
        protected modelCursorAnchor?: IModelPosition,
        protected keepLeftLock = false,
    ) {}

    apply(
        modelService: IModelService,
        cursorService: ICursorService,
        renderService: IRenderService,
        layoutService: ILayoutService,
    ): ITransformationResult {
        let originalCursorModelAnchor: IModelPosition | undefined = undefined;
        let originalCursorModelHead: IModelPosition | undefined = undefined;
        if (cursorService.hasCursor()) {
            const { anchor, head } = cursorService.getCursor();
            originalCursorModelAnchor = renderService.convertRenderToModelPosition(anchor);
            originalCursorModelHead = renderService.convertRenderToModelPosition(head);
        }
        const changeResults = this.applyChanges(modelService);
        if (cursorService.hasCursor()) {
            let { anchor: cursorAnchor, head: cursorHead } = cursorService.getCursor();
            if (this.modelCursorHead !== undefined) {
                cursorHead = renderService.convertModelToRenderPosition(this.modelCursorHead);
                cursorAnchor = cursorHead;
                if (this.modelCursorAnchor !== undefined) {
                    cursorAnchor = renderService.convertModelToRenderPosition(this.modelCursorAnchor);
                }
            }
            cursorAnchor = this.boundOffset(cursorAnchor, renderService);
            cursorHead = this.boundOffset(cursorHead, renderService);
            cursorService.setCursor(cursorAnchor, cursorHead);
            if (!this.keepLeftLock) {
                const { node: line, position: linePosition } = atLine(
                    layoutService.resolvePosition(cursorService.getCursor().head),
                );
                cursorService.setLeftLock(line.resolveBoundingBoxes(linePosition, linePosition).boundingBoxes[0].left);
            }
        }
        const reverseChanges: IChange[] = [];
        const reverseMappings: IMapping[] = [];
        for (let n = changeResults.length - 1; n >= 0; n--) {
            const changeResult = changeResults[n];
            reverseChanges.push(
                reverseMappings.reduce(
                    (reverseChange, reverseMapping) => reverseChange.map(reverseMapping),
                    changeResult.reverseChange,
                ),
            );
            reverseMappings.push(changeResult.mapping.reverse());
        }
        return new TransformationResult(
            this,
            changeResults,
            new Transformation(reverseChanges, originalCursorModelHead, originalCursorModelAnchor, this.keepLeftLock),
        );
    }

    protected applyChanges(modelService: IModelService) {
        const changeResults: IChangeResult[] = [];
        const mappings: IMapping[] = [];
        let changes = [...this.changes];
        while (changes.length > 0) {
            const change = changes.shift()!;
            const changeResult = modelService.applyChange(change);
            const mapping = changeResult.mapping;
            mappings.push(mapping);
            changes = changes.map((c) => c.map(mapping));
            changeResults.push(changeResult);
        }
        return changeResults;
    }

    protected boundOffset(offset: number, renderService: IRenderService) {
        return Math.max(0, Math.min(renderService.getDocSize() - 1, offset));
    }
}

export class TransformationResult implements ITransformationResult {
    constructor(
        readonly transformation: ITransformation,
        readonly changeResults: IChangeResult[],
        readonly reverseTransformation: ITransformation,
    ) {}
}
