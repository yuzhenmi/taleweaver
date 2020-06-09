import { IComponentService } from '../component/service';
import { EventEmitter } from '../event/emitter';
import { IEventListener, IOnEvent } from '../event/listener';
import { IChange, IChangeResult } from './change/change';
import { IMapping } from './change/mapping';
import { IModelRoot } from './root';
import { ITransformationResult } from './transformation';

export interface IDidTransformModelStateEvent {
    result: ITransformationResult;
}

export interface IModelState {
    readonly root: IModelRoot<any>;

    applyChanges(changes: IChange[]): [IChangeResult[], IMapping[]];
    onDidTransformModelState: IOnEvent<IDidTransformModelStateEvent>;
}

export class ModelState implements IModelState {
    protected didTransformModelStateEventEmitter = new EventEmitter<IDidTransformModelStateEvent>();

    constructor(readonly root: IModelRoot<any>, protected componentService: IComponentService) {}

    applyChanges(changes: IChange[]): [IChangeResult[], IMapping[]] {
        const changeResults: IChangeResult[] = [];
        const mappings: IMapping[] = [];
        changes.forEach((change) => {
            const changeResult = change.apply(this.root, mappings, this.componentService);
            changeResults.push(changeResult);
            mappings.push(changeResult.mapping);
        });
        return [changeResults, mappings];
    }

    onDidTransformModelState(listener: IEventListener<IDidTransformModelStateEvent>) {
        return this.didTransformModelStateEventEmitter.on(listener);
    }
}
