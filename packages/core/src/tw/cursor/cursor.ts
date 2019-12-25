import { EventEmitter, IEventEmitter } from '../event/emitter';
import { IEventListener, IOnEvent } from '../event/listener';

export interface IDidUpdateCursorEvent {}

export interface ICursor {
    onDidUpdateCursor: IOnEvent<IDidUpdateCursorEvent>;
    set(anchor: number, head: number, leftLock: number | null): void;
    getAnchor(): number;
    getHead(): number;
    getLeftLock(): number | null;
}

export class Cursor implements ICursor {
    protected didUpdateCursorEventEmitter: IEventEmitter<IDidUpdateCursorEvent> = new EventEmitter();
    protected anchor: number = 0;
    protected head: number = 0;
    protected leftLock: number | null = null;

    onDidUpdateCursor(listener: IEventListener<IDidUpdateCursorEvent>) {
        this.didUpdateCursorEventEmitter.on(listener);
    }

    set(anchor: number, head: number, leftLock: number | null) {
        this.anchor = anchor;
        this.head = head;
        this.leftLock = leftLock;
        this.didUpdateCursorEventEmitter.emit({});
    }

    getAnchor() {
        return this.anchor;
    }

    getHead() {
        return this.head;
    }

    getLeftLock() {
        return this.leftLock;
    }
}
