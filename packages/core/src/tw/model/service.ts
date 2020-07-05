import { IComponentService } from '../component/service';
import { IEventListener } from '../event/listener';
import { IChange, IChangeResult } from './change/change';
import { IModelNode } from './node';
import { IModelPosition, IResolvedModelPosition } from './position';
import { IModelRoot } from './root';
import { IDidUpdateModelStateEvent, IModelState, ModelState } from './state';

export interface IModelService {
    getRoot(): IModelRoot<any>;
    getRootSize(): number;
    applyChange(change: IChange): IChangeResult;
    resolvePosition(position: IModelPosition): IResolvedModelPosition;
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

    getRootSize() {
        return this.state.root.size;
    }

    applyChange(change: IChange) {
        return this.state.applyChange(change);
    }

    resolvePosition(position: IModelPosition) {
        return this.state.root.resolvePosition(position);
    }

    toDOM(from: number, to: number) {
        return this.state.root.toDOM(from, to);
    }

    fromDOM(domNodes: HTMLElement[]) {
        return [this.getRoot()];
    }

    onDidUpdateModelState(listener: IEventListener<IDidUpdateModelStateEvent>) {
        this.state.onDidUpdate(listener);
    }
}
