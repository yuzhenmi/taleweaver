import { EventEmitter } from '../event/emitter';
import { IEventListener, IOnEvent } from '../event/listener';

export interface IDidUpdateCursorEvent {}

export interface ICursor {
    readonly anchor: number;
    readonly head: number;

    leftLock: number | null;

    set(anchor: number, head: number): void;
    onDidUpdateCursor: IOnEvent<IDidUpdateCursorEvent>;
}

export class Cursor implements ICursor {
    protected internalAnchor: number = 0;
    protected internalHead: number = 0;
    protected didUpdateCursorEventEmitter = new EventEmitter<IDidUpdateCursorEvent>();

    leftLock: number | null = null;

    get anchor() {
        return this.internalAnchor;
    }

    get head() {
        return this.internalHead;
    }

    set(anchor: number, head: number) {
        this.internalAnchor = anchor;
        this.internalHead = head;
        this.didUpdateCursorEventEmitter.emit({});
    }

    onDidUpdateCursor(listener: IEventListener<IDidUpdateCursorEvent>) {
        return this.didUpdateCursorEventEmitter.on(listener);
    }
}
