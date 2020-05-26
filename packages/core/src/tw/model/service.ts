import { IEventListener } from '../event/listener';
import { IModelNode, IModelPosition } from './node';
import { IModelRoot } from './root';
import { IDidTransformModelStateEvent, IModelState, ModelState } from './state';
import { ITransformation, ITransformationResult } from './transformation';

export interface IModelService {
    getRoot(): IModelRoot<any>;
    applyTransformation(transformation: ITransformation): ITransformationResult;
    resolvePosition(offset: number): IModelPosition;
    toDOM(from: number, to: number): HTMLElement;
    fromDOM(domNodes: HTMLElement[]): IModelNode<any>[];
    onDidTransformModelState(listener: IEventListener<IDidTransformModelStateEvent>): void;
}

export class ModelService implements IModelService {
    protected state: IModelState;

    constructor(root: IModelRoot<any>) {
        this.state = new ModelState(root);
    }

    getRoot() {
        return this.state.root;
    }

    applyTransformation(transformation: ITransformation) {
        return this.state.applyTransformation(transformation);
    }

    resolvePosition(offset: number) {
        return this.state.root.resolvePosition(offset);
    }

    toDOM(from: number, to: number) {
        return this.state.root.toDOM(from, to);
    }

    fromDOM(domNodes: HTMLElement[]) {
        return [this.getRoot()];
    }

    onDidTransformModelState(listener: IEventListener<IDidTransformModelStateEvent>) {
        this.state.onDidTransformModelState(listener);
    }
}
