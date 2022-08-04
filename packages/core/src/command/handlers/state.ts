import { ComponentService } from '../../component/service';
import { CursorService } from '../../cursor/service';
import { DocModelNode } from '../../model/nodes/doc';
import { InsertContent } from '../../model/operation/insert-content';
import { Operation } from '../../model/operation/operation';
import { RemoveContent } from '../../model/operation/remove-content';
import { RemoveNode } from '../../model/operation/remove-node';
import { Path, IPosition, normalizePosition } from '../../model/position';
import { ModelService } from '../../model/service';
import { TransformService } from '../../transform/service';
import { Transformation } from '../../transform/transformation';
import { CommandHandler } from '../command';

function buildRemoveOperations(doc: DocModelNode<any>, from: IPosition, to: IPosition) {
    const operations: Operation[] = [];
    const [fromPath, fromOffset] = normalizePosition(from);
    const [toPath, toOffset] = normalizePosition(to);
    let parentFromPath: Path;
    let parentToPath: Path;
    if (fromOffset !== null && toOffset !== null) {
        parentFromPath = fromPath;
        parentToPath = toPath;
        if (JSON.stringify(parentFromPath) !== JSON.stringify(parentToPath)) {
            const parentFromNode = doc.findByPath(parentFromPath);
            if (parentFromNode.type !== 'block') {
                throw new Error('Expecting node for content removal to contain content.');
            }
            const length1 = parentFromNode.content.length - fromOffset;
            if (length1 > 0) {
                operations.push(new RemoveContent({ path: parentFromPath, offset: fromOffset }, length1));
            }
            const length2 = toOffset;
            if (length2 > 0) {
                operations.push(new RemoveContent({ path: parentToPath, offset: 0 }, length2));
            }
        } else {
            const length = toOffset - fromOffset;
            if (length > 0) {
                operations.push(new RemoveContent({ path: parentFromPath, offset: fromOffset }, toOffset - fromOffset));
            }
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

export class InsertCommandHandler implements CommandHandler {
    static dependencies = ['transform', 'cursor', 'model'] as const;

    constructor(
        protected transformService: TransformService,
        protected cursorService: CursorService,
        protected modelService: ModelService,
    ) {}

    async handle(content: string) {
        const cursor = this.cursorService.getCursor();
        if (!cursor) {
            return;
        }
        const operations: Operation[] = [];
        const from = Math.min(cursor.anchor, cursor.head);
        const to = Math.max(cursor.anchor, cursor.head);
        const modelFrom = this.modelService.offsetToPoint(from);
        if (from < to) {
            operations.push(
                ...buildRemoveOperations(this.modelService.getDoc(), modelFrom, this.modelService.offsetToPoint(to)),
            );
        }
        operations.push(new InsertContent(modelFrom, content.split('')));
        this.transformService.applyTransformation(new Transformation(operations, from + content.length));
    }
}

export class DeleteBackwardCommandHandler implements CommandHandler {
    static dependencies = ['transform', 'cursor', 'model'] as const;

    constructor(
        protected transformService: TransformService,
        protected cursorService: CursorService,
        protected modelService: ModelService,
    ) {}

    async handle() {
        const cursor = this.cursorService.getCursor();
        if (!cursor) {
            return;
        }
        const operations: Operation[] = [];
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
                this.modelService.offsetToPoint(from),
                this.modelService.offsetToPoint(to),
            ),
        );
        this.transformService.applyTransformation(new Transformation(operations, from));
    }
}

export class DeleteForwardCommandHandler implements CommandHandler {
    static dependencies = ['transform', 'cursor', 'model'] as const;

    constructor(
        protected transformService: TransformService,
        protected cursorService: CursorService,
        protected modelService: ModelService,
    ) {}

    async handle() {
        const cursor = this.cursorService.getCursor();
        if (!cursor) {
            return;
        }
        const operations: Operation[] = [];
        let from: number;
        let to: number;
        if (cursor.anchor === cursor.head) {
            if (cursor.head >= this.modelService.getDocSize() - 1) {
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
                this.modelService.offsetToPoint(from),
                this.modelService.offsetToPoint(to),
            ),
        );
        this.transformService.applyTransformation(new Transformation(operations, from));
    }
}

export class BreakLineCommandHandler implements CommandHandler {
    static dependencies = ['transform', 'cursor', 'model'] as const;

    constructor(
        protected transformService: TransformService,
        protected cursorService: CursorService,
        protected modelService: ModelService,
    ) {}

    async handle() {
        const cursor = this.cursorService.getCursor();
        if (!cursor) {
            return;
        }
        const operations: Operation[] = [];
        const from = Math.min(cursor.anchor, cursor.head);
        const to = Math.max(cursor.anchor, cursor.head);
        const modelFrom = this.modelService.offsetToPoint(from);
        if (from < to) {
            operations.push(
                ...buildRemoveOperations(this.modelService.getDoc(), modelFrom, this.modelService.offsetToPoint(to)),
            );
        }
        // TODO: Add split operation
        console.log(modelFrom);
        this.transformService.applyTransformation(new Transformation(operations, from + 1));
    }
}

export class ApplyAttributesCommandHandler implements CommandHandler {
    static dependencies = ['transform', 'component', 'cursor', 'model'] as const;

    constructor(
        protected transformService: TransformService,
        protected componentService: ComponentService,
        protected cursorService: CursorService,
        protected modelService: ModelService,
    ) {}

    async handle(componentId: string, attributeKey: string, attributeValue: any) {
        const cursor = this.cursorService.getCursor();
        if (!cursor) {
            return;
        }
        const operations: Operation[] = [];
        const from = Math.min(cursor.anchor, cursor.head);
        const to = Math.max(cursor.anchor, cursor.head);
        // TODO: Apply attribute to all nodes between "from" and "to"
        console.log(from, to);
        this.transformService.applyTransformation(new Transformation(operations));
    }
}

export class ApplyMarksCommandHandler implements CommandHandler {
    static dependencies = ['transform', 'component', 'cursor', 'model'] as const;

    constructor(
        protected transformService: TransformService,
        protected componentService: ComponentService,
        protected cursorService: CursorService,
        protected modelService: ModelService,
    ) {}

    async handle(componentId: string, attributeKey: string, attributeValue: any) {
        const cursor = this.cursorService.getCursor();
        if (!cursor) {
            return;
        }
        const operations: Operation[] = [];
        const from = Math.min(cursor.anchor, cursor.head);
        const to = Math.max(cursor.anchor, cursor.head);
        // TODO: Apply marks to all content between "from" and "to"
        console.log(from, to);
        this.transformService.applyTransformation(new Transformation(operations));
    }
}
