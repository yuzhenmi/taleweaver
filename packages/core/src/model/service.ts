import { IEventListener } from '../event/listener';
import { IDocModelNode } from './node';
import { IOperation, IOperationResult } from './operation/operation';
import { IPoint } from './position';
import { IDidUpdateModelStateEvent, IModelState, ModelState } from './state';

export interface IModelService {
    getDoc(): IDocModelNode;
    getDocContentSize(): number;
    toContentPosition(position: IPoint): number;
    fromContentPosition(contentPosition: number): IPoint;
    applyOperation(operation: IOperation): IOperationResult;
    onDidUpdateModelState(
        listener: IEventListener<IDidUpdateModelStateEvent>,
    ): void;
}

export class ModelService implements IModelService {
    protected state: IModelState;

    constructor(doc: IDocModelNode) {
        this.state = new ModelState(doc);
    }

    getDoc() {
        return this.state.doc;
    }

    getDocContentSize() {
        return this.state.doc.contentSize;
    }

    toContentPosition(position: IPoint) {
        return this.state.doc.toContentPosition(position);
    }

    fromContentPosition(contentPosition: number) {
        return this.state.doc.fromContentPosition(contentPosition);
    }

    applyOperation(operation: IOperation) {
        return this.state.applyOperation(operation);
    }

    onDidUpdateModelState(listener: IEventListener<IDidUpdateModelStateEvent>) {
        this.state.onDidUpdate(listener);
    }
}
