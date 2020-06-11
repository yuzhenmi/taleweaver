import { IComponentService } from '../component/service';
import { EventEmitter } from '../event/emitter';
import { IEventListener, IOnEvent } from '../event/listener';
import { IChange, IChangeResult } from './change/change';
import { IMapping } from './change/mapping';
import { IModelRoot } from './root';

export interface IDidUpdateModelStateEvent {
    changeResults: IChangeResult[];
    mappings: IMapping[];
}

export interface IModelState {
    readonly root: IModelRoot<any>;

    applyChanges(changes: IChange[]): [IChangeResult[], IMapping[]];
    onDidUpdateModelState: IOnEvent<IDidUpdateModelStateEvent>;
}

export class ModelState implements IModelState {
    protected didUpdateModelStateEventEmitter = new EventEmitter<IDidUpdateModelStateEvent>();

    constructor(readonly root: IModelRoot<any>, protected componentService: IComponentService) {}

    applyChanges(changes: IChange[]): [IChangeResult[], IMapping[]] {
        const changeResults: IChangeResult[] = [];
        const mappings: IMapping[] = [];
        changes.forEach((change) => {
            const changeResult = change.apply(this.root, mappings, this.componentService);
            changeResults.push(changeResult);
            mappings.push(changeResult.mapping);
        });
        this.didUpdateModelStateEventEmitter.emit({ changeResults, mappings });
        return [changeResults, mappings];
    }

    onDidUpdateModelState(listener: IEventListener<IDidUpdateModelStateEvent>) {
        return this.didUpdateModelStateEventEmitter.on(listener);
    }
}
