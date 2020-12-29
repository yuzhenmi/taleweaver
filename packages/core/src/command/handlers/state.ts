import { IComponentService } from '../../component/service';
import { ICursorService } from '../../cursor/service';
import { IDocModelNode } from '../../model/node';
import { InsertContent } from '../../model/operation/insert-content';
import { IOperation } from '../../model/operation/operation';
import { RemoveContent } from '../../model/operation/remove-content';
import { RemoveNode } from '../../model/operation/remove-node';
import { IPath, IPosition, normalizePosition } from '../../model/position';
import { IModelService } from '../../model/service';
import { ITransformService } from '../../transform/service';
import { Transformation } from '../../transform/transformation';
import { ICommandHandler } from '../command';

function buildRemoveOperations(doc: IDocModelNode, from: IPosition, to: IPosition) {
    const operations: IOperation[] = [];
    const [fromPath, fromOffset] = normalizePosition(from);
    const [toPath, toOffset] = normalizePosition(to);
    let parentFromPath: IPath;
    let parentToPath: IPath;
    if (fromOffset !== null && toOffset !== null) {
        parentFromPath = fromPath;
        parentToPath = toPath;
        if (JSON.stringify(parentFromPath) !== JSON.stringify(parentToPath)) {
            const parentFromNode = doc.findByPath(parentFromPath);
            if (parentFromNode.type !== 'block') {
                throw new Error('Expecting node for content removal to contain content.');
            }
            operations.push(
                new RemoveContent(
                    { path: parentFromPath, offset: fromOffset },
                    parentFromNode.content.length - fromOffset,
                ),
            );
            operations.push(new RemoveContent({ path: parentToPath, offset: 0 }, toOffset));
        } else {
            operations.push(new RemoveContent({ path: parentFromPath, offset: fromOffset }, toOffset - fromOffset));
        }
    } else if (fromPath.length > 0 && toPath.length > 0) {
        parentFromPath = fromPath.slice(0, fromPath.length - 1);
        parentToPath = toPath.slice(0, toPath.length - 1);
        if (JSON.stringify(parentFromPath) !== JSON.stringify(parentToPath)) {
            const parentFromNode = doc.findByPath(parentFromPath);
            if (parentFromNode.type !== 'doc') {
                throw new Error('Expecting node for node removal to contain children.');
            }
            for (let n = fromPath[fromPath.length - 1], nn = parentFromNode.children.length; n < nn; n++) {
                operations.push(new RemoveNode(parentFromPath, n));
            }
            for (let n = 0, nn = toPath[toPath.length - 1]; n < nn; n++) {
                operations.push(new RemoveNode(parentToPath, n));
            }
        } else {
            for (let n = fromPath[fromPath.length - 1], nn = toPath[toPath.length - 1]; n < nn; n++) {
                operations.push(new RemoveNode(parentFromPath, n));
            }
        }
    } else {
        return [];
    }
    operations.push(...buildRemoveOperations(doc, parentFromPath, parentToPath));
    return operations;
}

export class InsertCommandHandler implements ICommandHandler {
    static dependencies = ['transform', 'cursor', 'model'] as const;

    constructor(
        protected transformService: ITransformService,
        protected cursorService: ICursorService,
        protected modelService: IModelService,
    ) {}

    async handle(content: string) {
        const cursor = this.cursorService.getCursor();
        if (!cursor) {
            return;
        }
        const operations: IOperation[] = [];
        const from = Math.min(cursor.anchor, cursor.head);
        const to = Math.max(cursor.anchor, cursor.head);
        const modelFrom = this.modelService.fromContentPosition(from);
        if (from < to) {
            operations.push(
                ...buildRemoveOperations(
                    this.modelService.getDoc(),
                    modelFrom,
                    this.modelService.fromContentPosition(to),
                ),
            );
        }
        operations.push(new InsertContent(modelFrom, content.split('')));
        this.transformService.applyTransformation(new Transformation(operations, from + content.length));
    }
}

export class DeleteBackwardCommandHandler implements ICommandHandler {
    static dependencies = ['transform', 'cursor', 'model'] as const;

    constructor(
        protected transformService: ITransformService,
        protected cursorService: ICursorService,
        protected modelService: IModelService,
    ) {}

    async handle() {
        const cursor = this.cursorService.getCursor();
        if (!cursor) {
            return;
        }
        const operations: IOperation[] = [];
        let from: number;
        let to: number;
        if (cursor.anchor === cursor.head) {
            if (cursor.head === 0) {
                return;
            }
            from = cursor.head - 1;
            to = cursor.head;
        } else {
            from = Math.min(cursor.anchor, cursor.head);
            to = Math.max(cursor.anchor, cursor.head);
        }
        operations.push(
            ...buildRemoveOperations(
                this.modelService.getDoc(),
                this.modelService.fromContentPosition(from),
                this.modelService.fromContentPosition(to),
            ),
        );
        this.transformService.applyTransformation(new Transformation(operations, from));
    }
}

export class DeleteForwardCommandHandler implements ICommandHandler {
    static dependencies = ['transform', 'cursor', 'model'] as const;

    constructor(
        protected transformService: ITransformService,
        protected cursorService: ICursorService,
        protected modelService: IModelService,
    ) {}

    async handle() {
        const cursor = this.cursorService.getCursor();
        if (!cursor) {
            return;
        }
        const operations: IOperation[] = [];
        let from: number;
        let to: number;
        if (cursor.anchor === cursor.head) {
            if (cursor.head >= this.modelService.getDocContentSize() - 1) {
                return;
            }
            from = cursor.head;
            to = cursor.head + 1;
        } else {
            from = Math.min(cursor.anchor, cursor.head);
            to = Math.max(cursor.anchor, cursor.head);
        }
        operations.push(
            ...buildRemoveOperations(
                this.modelService.getDoc(),
                this.modelService.fromContentPosition(from),
                this.modelService.fromContentPosition(to),
            ),
        );
        this.transformService.applyTransformation(new Transformation(operations, from));
    }
}

export class BreakLineCommandHandler implements ICommandHandler {
    static dependencies = ['transform', 'cursor', 'model'] as const;

    constructor(
        protected transformService: ITransformService,
        protected cursorService: ICursorService,
        protected modelService: IModelService,
    ) {}

    async handle() {
        const cursor = this.cursorService.getCursor();
        if (!cursor) {
            return;
        }
        const operations: IOperation[] = [];
        const from = Math.min(cursor.anchor, cursor.head);
        const to = Math.max(cursor.anchor, cursor.head);
        const modelFrom = this.modelService.fromContentPosition(from);
        if (from < to) {
            operations.push(
                ...buildRemoveOperations(
                    this.modelService.getDoc(),
                    modelFrom,
                    this.modelService.fromContentPosition(to),
                ),
            );
        }
        // TODO: Add split operation
        console.log(modelFrom);
        this.transformService.applyTransformation(new Transformation(operations, from + 1));
    }
}

export class ApplyAttributesCommandHandler implements ICommandHandler {
    static dependencies = ['transform', 'component', 'cursor', 'model'] as const;

    constructor(
        protected transformService: ITransformService,
        protected componentService: IComponentService,
        protected cursorService: ICursorService,
        protected modelService: IModelService,
    ) {}

    async handle(componentId: string, attributeKey: string, attributeValue: any) {
        const cursor = this.cursorService.getCursor();
        if (!cursor) {
            return;
        }
        const operations: IOperation[] = [];
        const from = Math.min(cursor.anchor, cursor.head);
        const to = Math.max(cursor.anchor, cursor.head);
        // TODO: Apply attribute to all nodes between "from" and "to"
        console.log(from, to);
        this.transformService.applyTransformation(new Transformation(operations));
    }
}

export class ApplyMarksCommandHandler implements ICommandHandler {
    static dependencies = ['transform', 'component', 'cursor', 'model'] as const;

    constructor(
        protected transformService: ITransformService,
        protected componentService: IComponentService,
        protected cursorService: ICursorService,
        protected modelService: IModelService,
    ) {}

    async handle(componentId: string, attributeKey: string, attributeValue: any) {
        const cursor = this.cursorService.getCursor();
        if (!cursor) {
            return;
        }
        const operations: IOperation[] = [];
        const from = Math.min(cursor.anchor, cursor.head);
        const to = Math.max(cursor.anchor, cursor.head);
        // TODO: Apply marks to all content between "from" and "to"
        console.log(from, to);
        this.transformService.applyTransformation(new Transformation(operations));
    }
}
