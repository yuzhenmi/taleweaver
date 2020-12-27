import { IComponentService } from '../../component/service';
import { ICursorService } from '../../cursor/service';
import { InsertContent } from '../../model/operation/insert-content';
import { IOperation } from '../../model/operation/operation';
import { IModelService } from '../../model/service';
import { ITransformService } from '../../transform/service';
import { Transformation } from '../../transform/transformation';
import { ICommandHandler } from '../command';

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
            // TODO: Remove content between "from" and "to"
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
        // TODO: Remove content between "from" and "to"
        console.log(to);
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
        // TODO: Remove content between "from" and "to"
        console.log(to);
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
            // TODO: Remove content between "from" and "to"
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
