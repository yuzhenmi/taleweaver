import { IComponentService } from '../component/service';
import { IEventListener } from '../event/listener';
import { IStateService } from '../state/service';
import { IDocModelNode } from './doc-node';
import { IModelPosition } from './node';
import { IDidUpdateModelStateEvent, IModelState, ModelState } from './state';

export interface IModelService {
    onDidUpdateModelState(listener: IEventListener<IDidUpdateModelStateEvent>): void;
    getDocNode(): IDocModelNode;
    toHTML(from: number, to: number): string;
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

    toHTML(from: number, to: number) {
        const domNode = this.state.getDocNode().toDOM(from, to);
        return domNode.outerHTML;
    }

    resolvePosition(offset: number) {
        return this.state.getDocNode().resolvePosition(offset);
    }
}
