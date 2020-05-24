import { IEventListener } from '../event/listener';
import { IModelNode, IModelPosition } from './node';
import { IModelRoot } from './root';
import { IDidTransformModelStateEvent, IModelState, ModelState } from './state';

export interface IModelService {
    getRoot(): IModelRoot<any>;
    onDidTransformModelState(listener: IEventListener<IDidTransformModelStateEvent>): void;
    resolvePosition(offset: number): IModelPosition;
    toDOM(from: number, to: number): HTMLElement;
    fromDOM(domNodes: HTMLElement[]): IModelNode<any>[];
}

export class ModelService implements IModelService {
    protected state: IModelState;

    constructor(root: IModelRoot<any>) {
        this.state = new ModelState(root);
    }

    getRoot() {
        return this.state.root;
    }

    onDidTransformModelState(listener: IEventListener<IDidTransformModelStateEvent>) {
        this.state.onDidTransformModelState(listener);
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
}
