import { IComponentService } from '../component/service';
import { IEventListener } from '../event/listener';
import { IStateService } from '../state/service';
import { IModelNode, IModelPosition } from './node';
import { IModelRoot } from './root';
import { IDidUpdateModelStateEvent, IModelState, ModelState } from './state';

export interface IModelService {
    onDidUpdateModelState(listener: IEventListener<IDidUpdateModelStateEvent>): void;
    getRoot(): IModelRoot<any>;
    toDOM(from: number, to: number): HTMLElement;
    fromDOM(domNodes: HTMLElement[]): IModelNode<any>[];
    resolvePosition(offset: number): IModelPosition;
}

export class ModelService implements IModelService {
    protected state: IModelState;

    constructor(componentService: IComponentService, stateService: IStateService) {
        this.state = new ModelState(componentService, stateService);
    }

    onDidUpdateModelState(listener: IEventListener<IDidUpdateModelStateEvent>) {
        this.state.onDidUpdateModelState(listener);
    }

    getRoot() {
        return this.state.root;
    }

    toDOM(from: number, to: number) {
        return this.state.root.toDOM(from, to);
    }

    fromDOM(domNodes: HTMLElement[]) {
        return [this.getRoot()];
    }

    resolvePosition(offset: number) {
        return this.state.root.resolvePosition(offset);
    }
}
