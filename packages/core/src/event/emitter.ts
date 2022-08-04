import { EventListener } from './listener';

export interface Disposable {
    dispose(): void;
}

export class EventEmitter<TEvent> {
    protected listeners: EventListener<TEvent>[] = [];

    on(listener: EventListener<TEvent>): Disposable {
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
