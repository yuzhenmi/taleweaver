import { IComponentService } from 'tw/component/service';
import { IModelPosition } from 'tw/model/node';
import { IRootModelNode } from 'tw/model/root-node';
import { IModelState, ModelState } from 'tw/model/state';
import { IService } from 'tw/service/service';
import { IStateService } from 'tw/state/service';

export interface IModelService extends IService {
    getRootNode(): IRootModelNode;
    toHTML(from: number, to: number): string;
    resolvePosition(offset: number): IModelPosition;
}

export class ModelService implements IModelService {
    protected state: IModelState;

    constructor(componentService: IComponentService, stateService: IStateService) {
        this.state = new ModelState(componentService, stateService);
    }

    getRootNode() {
        return this.state.getRootNode();
    }

    toHTML(from: number, to: number) {
        const domNode = this.state.getRootNode().toDOM(from, to);
        return domNode.outerHTML;
    }

    resolvePosition(offset: number) {
        return this.state.getRootNode().resolvePosition(offset);
    }
}
