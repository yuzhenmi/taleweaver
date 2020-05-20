import { IComponentService } from '../component/service';
import { IEventListener } from '../event/listener';
import { IStateService } from '../state/service';
import { IToken } from '../state/token';
import { IModelNode, IModelPosition } from './node';
import { TokenParser } from './parser';
import { IModelRoot } from './root';
import { IDidUpdateModelStateEvent, IModelState, ModelState } from './state';

export interface IModelService {
    onDidUpdateModelState(listener: IEventListener<IDidUpdateModelStateEvent>): void;
    getRoot(): IModelRoot<any>;
    toDOM(from: number, to: number): HTMLElement;
    fromDOM(domNodes: HTMLElement[]): IModelNode<any>[];
    resolvePosition(offset: number): IModelPosition;
    parseTokens(tokens: IToken[]): IModelNode<any>;
}

export class ModelService implements IModelService {
    protected state: IModelState;

    constructor(protected componentService: IComponentService, protected stateService: IStateService) {
        this.state = new ModelState(componentService, stateService, this);
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

    parseTokens(tokens: IToken[]) {
        const parser = new TokenParser(this.componentService);
        return parser.parse(tokens);
    }
}
