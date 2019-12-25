import { IEventListener } from './listener';

export interface IEventEmitter<TEvent> {
    on(listener: IEventListener<TEvent>): void;
    emit(event: TEvent): void;
}

export class EventEmitter<TEvent> {
    protected listeners: IEventListener<TEvent>[] = [];

    on(listener: IEventListener<TEvent>) {
        this.listeners.push(listener);
    }

    emit(event: TEvent) {
        this.listeners.forEach(listener => listener(event));
    }
}
