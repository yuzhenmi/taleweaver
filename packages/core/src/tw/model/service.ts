import { IComponentService } from 'tw/component/service';
import { IEventListener } from 'tw/event/listener';
import { IDocModelNode } from 'tw/model/doc-node';
import { IModelPosition } from 'tw/model/node';
import { IDidUpdateModelStateEvent, IModelState, ModelState } from 'tw/model/state';
import { IService } from 'tw/service/service';
import { IStateService } from 'tw/state/service';

export interface IModelService extends IService {
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
