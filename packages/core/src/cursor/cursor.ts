import { IConfigService } from '../config/service';
import { EventEmitter } from '../event/emitter';
import { IEventListener, IOnEvent } from '../event/listener';

export interface IDidUpdateCursorEvent {}

export interface ICursor {
    readonly anchor: number;
    readonly head: number;
    readonly leftLock: number;

    setAnchor(anchor: number): void;
    setHead(head: number): void;
    setLeftLock(leftLock: number): void;
    onDidUpdate: IOnEvent<IDidUpdateCursorEvent>;
}

export interface IReadOnlyCursor {
    readonly anchor: number;
    readonly head: number;
    readonly leftLock: number;
}

export interface ICursorState {
    readonly cursor: IReadOnlyCursor | null;
}

export class Cursor implements ICursor {
    protected internalAnchor = 0;
    protected internalHead = 0;
    protected internalLeftLock: number = 0;
    protected didUpdateEventEmitter = new EventEmitter<IDidUpdateCursorEvent>();

    get anchor() {
        return this.internalAnchor;
    }

    get head() {
        return this.internalHead;
    }

    get leftLock() {
        return this.internalLeftLock;
    }

    setAnchor(anchor: number) {
        this.internalAnchor = anchor;
        this.didUpdateEventEmitter.emit({});
    }

    setHead(head: number) {
        this.internalHead = head;
        this.didUpdateEventEmitter.emit({});
    }

    setLeftLock(leftLock: number) {
        this.internalLeftLock = leftLock;
    }

    onDidUpdate(listener: IEventListener<IDidUpdateCursorEvent>) {
        return this.didUpdateEventEmitter.on(listener);
    }
}

export class CursorState implements ICursorState {
    protected internalCursor: ICursor | null = null;

    constructor(configService: IConfigService) {
        if (!configService.getConfig().cursor.disable) {
            this.internalCursor = new Cursor();
        }
    }

    get cursor() {
        if (!this.internalCursor) {
            return null;
        }
        return {
            anchor: this.internalCursor.anchor,
            head: this.internalCursor.head,
            leftLock: this.internalCursor.leftLock,
        };
    }
}
