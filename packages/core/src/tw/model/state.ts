import { IComponentService } from '../component/service';
import { EventEmitter } from '../event/emitter';
import { IEventListener, IOnEvent } from '../event/listener';
import { IModelChange, IModelChangeResult } from './change/change';
import { IModelRoot } from './root';

export interface IDidUpdateModelStateEvent {
    changeResult: IModelChangeResult;
}

export interface IModelState {
    readonly root: IModelRoot<any>;

    applyChange(change: IModelChange): IModelChangeResult;
    onDidUpdate: IOnEvent<IDidUpdateModelStateEvent>;
}

export class ModelState implements IModelState {
    protected didUpdateEventEmitter = new EventEmitter<IDidUpdateModelStateEvent>();

    constructor(readonly root: IModelRoot<any>, protected componentService: IComponentService) {}

    applyChange(change: IModelChange) {
        console.log(change, this.root);
        const changeResult = change.apply(this.root, this.componentService);
        this.didUpdateEventEmitter.emit({ changeResult });
        return changeResult;
    }

    onDidUpdate(listener: IEventListener<IDidUpdateModelStateEvent>) {
        return this.didUpdateEventEmitter.on(listener);
    }
}
