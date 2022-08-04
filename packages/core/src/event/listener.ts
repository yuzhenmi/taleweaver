import { Disposable } from './emitter';

export interface EventListener<TEvent> {
    (event: TEvent): void;
}

export interface OnEvent<TEvent> {
    (listener: EventListener<TEvent>): Disposable;
}
