import { ConfigService } from '../config/service';
import { EventEmitter } from '../event/emitter';
import { EventListener } from '../event/listener';

export interface DidUpdateCursorEvent {}

export interface ReadOnlyCursor {
    readonly anchor: number;
    readonly head: number;
    readonly leftLock: number;
}

export class Cursor {
    protected internalAnchor = 0;
    protected internalHead = 0;
    protected internalLeftLock: number = 0;
    protected didUpdateEventEmitter = new EventEmitter<DidUpdateCursorEvent>();

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

    onDidUpdate(listener: EventListener<DidUpdateCursorEvent>) {
        return this.didUpdateEventEmitter.on(listener);
    }
}

export class CursorState {
    protected internalCursor: Cursor | null = null;

    constructor(configService: ConfigService) {
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
