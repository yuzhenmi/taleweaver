import { IComponentService } from '../component/service';
import { IEventListener } from '../event/listener';
import { IStateService } from '../state/service';
import { IDocModelNode } from './doc-node';
import { IModelNode, IModelPosition } from './node';
import { IDidUpdateModelStateEvent, IModelState, ModelState } from './state';

export interface IModelService {
    onDidUpdateModelState(listener: IEventListener<IDidUpdateModelStateEvent>): void;
    getDocNode(): IDocModelNode;
    toDOM(from: number, to: number): HTMLElement;
    fromDOM(domNodes: HTMLElement[]): IModelNode[];
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

    getDocNode() {
        return this.state.getDocNode();
    }

    toDOM(from: number, to: number) {
        return this.state.getDocNode().toDOM(from, to);
    }

    fromDOM(domNodes: HTMLElement[]) {
        return [this.getDocNode()];
    }

    resolvePosition(offset: number) {
        return this.state.getDocNode().resolvePosition(offset);
    }
}
