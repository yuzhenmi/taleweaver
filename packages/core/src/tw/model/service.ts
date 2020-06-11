import { IComponentService } from '../component/service';
import { IEventListener } from '../event/listener';
import { IChange, IChangeResult } from './change/change';
import { IMapping } from './change/mapping';
import { IModelNode, IModelPosition } from './node';
import { IModelRoot } from './root';
import { IDidUpdateModelStateEvent, IModelState, ModelState } from './state';

export interface IModelService {
    getRoot(): IModelRoot<any>;
    applyChanges(changes: IChange[]): [IChangeResult[], IMapping[]];
    resolvePosition(offset: number): IModelPosition;
    toDOM(from: number, to: number): HTMLElement;
    fromDOM(domNodes: HTMLElement[]): IModelNode<any>[];
    onDidUpdateModelState(listener: IEventListener<IDidUpdateModelStateEvent>): void;
}

export class ModelService implements IModelService {
    protected state: IModelState;

    constructor(root: IModelRoot<any>, componentService: IComponentService) {
        this.state = new ModelState(root, componentService);
    }

    getRoot() {
        return this.state.root;
    }

    applyChanges(changes: IChange[]) {
        return this.state.applyChanges(changes);
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

    onDidUpdateModelState(listener: IEventListener<IDidUpdateModelStateEvent>) {
        this.state.onDidUpdateModelState(listener);
    }
}
