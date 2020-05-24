import { EventEmitter } from '../event/emitter';
import { IEventListener, IOnEvent } from '../event/listener';
import { IModelRoot } from './root';
import { ITransformation, ITransformationResult } from './transformation';

export interface IDidTransformModelStateEvent {
    result: ITransformationResult;
}

export interface IModelState {
    readonly root: IModelRoot<any>;

    applyTransformation(transformation: ITransformation): ITransformationResult;
    onDidTransformModelState: IOnEvent<IDidTransformModelStateEvent>;
}

export class ModelState implements IModelState {
    protected didTransformModelStateEventEmitter = new EventEmitter<IDidTransformModelStateEvent>();

    constructor(readonly root: IModelRoot<any>) {}

    applyTransformation(transformation: ITransformation) {
        const result = transformation.apply(this.root);
        this.didTransformModelStateEventEmitter.emit({ result });
        return result;
    }

    onDidTransformModelState(listener: IEventListener<IDidTransformModelStateEvent>) {
        return this.didTransformModelStateEventEmitter.on(listener);
    }
}
