import { CursorService } from '../cursor/service';
import { LayoutService } from '../layout/service';
import { Mapping } from '../model/operation/mapping';
import { Operation, OperationResult } from '../model/operation/operation';
import { ModelService } from '../model/service';

export class Transformation {
    constructor(
        protected operations: Operation[],
        protected cursorHead?: number,
        protected cursorAnchor?: number,
        protected keepLeftLock = false,
    ) {}

    apply(
        modelService: ModelService,
        cursorService: CursorService,
        layoutService: LayoutService,
    ): TransformationResult {
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
        const reverseOperations: Operation[] = [];
        const reverseMappings: Mapping[] = [];
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

    protected applyOperations(modelService: ModelService) {
        const operationResults: OperationResult[] = [];
        const mappings: Mapping[] = [];
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

    protected boundContentPosition(contentPosition: number, modelService: ModelService) {
        return Math.max(0, Math.min(modelService.getDocSize() - 1, contentPosition));
    }
}

export class TransformationResult {
    constructor(
        readonly transformation: Transformation,
        readonly operationResults: OperationResult[],
        readonly reverseTransformation: Transformation,
    ) {}
}
