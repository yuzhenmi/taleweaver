import { ICursorService } from '../cursor/service';
import { ILayoutService } from '../layout/service';
import { IMapping } from '../model/operation/mapping';
import { IOperation, IOperationResult } from '../model/operation/operation';
import { IModelService } from '../model/service';

export interface ITransformation {
    apply(
        modelService: IModelService,
        cursorService: ICursorService,
        layoutService: ILayoutService,
    ): ITransformationResult;
}

export interface ITransformationResult {
    readonly transformation: ITransformation;
    readonly operationResults: IOperationResult[];
    readonly reverseTransformation: ITransformation;
}

export class Transformation implements ITransformation {
    constructor(
        protected operations: IOperation[],
        protected cursorHead?: number,
        protected cursorAnchor?: number,
        protected keepLeftLock = false,
    ) {}

    apply(
        modelService: IModelService,
        cursorService: ICursorService,
        layoutService: ILayoutService,
    ): ITransformationResult {
        let originalCursorAnchor: number | undefined = undefined;
        let originalCursorHead: number | undefined = undefined;
        const cursor = cursorService.getCursor();
        if (cursor) {
            originalCursorAnchor = cursor.anchor;
            originalCursorHead = cursor.head;
        }
        const operationResults = this.applyOperations(modelService);
        if (cursor) {
            let cursorHead = this.cursorHead ?? cursor.head;
            let cursorAnchor = this.cursorAnchor ?? this.cursorHead ?? cursor.anchor;
            cursorAnchor = this.boundContentPosition(cursorAnchor, modelService);
            cursorHead = this.boundContentPosition(cursorHead, modelService);
            cursorService.setCursor(cursorAnchor, cursorHead);
            if (!this.keepLeftLock) {
                const { node: lineLayoutNode, position: linePosition } = layoutService
                    .describePosition(cursorHead)
                    .atLine();
                cursorService.setLeftLock(
                    lineLayoutNode.resolveBoundingBoxes(linePosition, linePosition).boundingBoxes[0].left,
                );
            }
        }
        const reverseOperations: IOperation[] = [];
        const reverseMappings: IMapping[] = [];
        for (let n = operationResults.length - 1; n >= 0; n--) {
            const operationResult = operationResults[n];
            reverseOperations.push(
                reverseMappings.reduce(
                    (reverseOperation, reverseMapping) => reverseOperation.map(reverseMapping),
                    operationResult.reverseOperation,
                ),
            );
            reverseMappings.push(operationResult.mapping.reverse());
        }
        return new TransformationResult(
            this,
            operationResults,
            new Transformation(reverseOperations, originalCursorHead, originalCursorAnchor, this.keepLeftLock),
        );
    }

    protected applyOperations(modelService: IModelService) {
        const operationResults: IOperationResult[] = [];
        const mappings: IMapping[] = [];
        let operations = [...this.operations];
        while (operations.length > 0) {
            const operation = operations.shift()!;
            const operationResult = modelService.applyOperation(operation);
            const mapping = operationResult.mapping;
            mappings.push(mapping);
            operations = operations.map((c) => c.map(mapping));
            operationResults.push(operationResult);
        }
        return operationResults;
    }

    protected boundContentPosition(contentPosition: number, modelService: IModelService) {
        return Math.max(0, Math.min(modelService.getDocContentSize() - 1, contentPosition));
    }
}

export class TransformationResult implements ITransformationResult {
    constructor(
        readonly transformation: ITransformation,
        readonly operationResults: IOperationResult[],
        readonly reverseTransformation: ITransformation,
    ) {}
}
