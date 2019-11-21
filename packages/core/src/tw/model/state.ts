import { IComponentService } from 'tw/component/service';
import TokenParser from 'tw/model/parser';
import { IRootModelNode } from 'tw/model/root-node';
import { IStateService } from 'tw/state/service';
import { IDidUpdateStateEvent } from 'tw/state/state';

export interface IModelState {
    getRootNode(): IRootModelNode;
}

export class ModelState implements IModelState {
    protected rootNode: IRootModelNode;

    constructor(protected componentService: IComponentService, protected stateService: IStateService) {
        const tokens = stateService.getTokens();
        const parser = new TokenParser(componentService);
        this.rootNode = parser.parse(tokens) as IRootModelNode;
        stateService.onDidUpdateState(event => this.handleDidUpdateStateEvent(event));
    }

    getRootNode() {
        return this.rootNode;
    }

    protected handleDidUpdateStateEvent(event: IDidUpdateStateEvent) {
        // TODO
    }
}
