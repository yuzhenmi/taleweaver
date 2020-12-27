import { IEventListener } from './listener';

export interface IDisposable {
    dispose(): void;
}

export interface IEventEmitter<TEvent> {
    on(listener: IEventListener<TEvent>): IDisposable;
    emit(event: TEvent): void;
}

export class EventEmitter<TEvent> {
    protected listeners: IEventListener<TEvent>[] = [];

    on(listener: IEventListener<TEvent>): IDisposable {
        this.listeners.push(listener);
        return {
            dispose: () => {
                const index = this.listeners.indexOf(listener);
                if (index < 0) {
                    return;
                }
                this.listeners.splice(index, 1);
            },
        };
    }

    emit(event: TEvent) {
        this.listeners.forEach((listener) => listener(event));
    }
}
