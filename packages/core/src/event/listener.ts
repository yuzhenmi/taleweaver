import { IDisposable } from './emitter';

export interface IEventListener<TEvent> {
    (event: TEvent): void;
}

export interface IOnEvent<TEvent> {
    (listener: IEventListener<TEvent>): IDisposable;
}
