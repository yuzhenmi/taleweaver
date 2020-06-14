import { IConfigService } from '../config/service';
import { EventEmitter } from '../event/emitter';
import { IEventListener, IOnEvent } from '../event/listener';
import { ICursorChange, ICursorChangeResult } from './change/change';

export interface ICursor {
    anchor: number;
    head: number;
    leftLock: number;
}

export interface IDidUpdateCursorEvent {}

export interface ICursorState {
    readonly hasCursor: boolean;
    readonly cursor: ICursor;

    set(anchor: number, head: number): void;
    setLeftLock(leftLock: number): void;
    applyChange(change: ICursorChange): ICursorChangeResult;
    onDidUpdate: IOnEvent<IDidUpdateCursorEvent>;
}

export class CursorState {
    protected internalCursor: ICursor | null = null;
    protected didUpdateEventEmitter = new EventEmitter<IDidUpdateCursorEvent>();

    constructor(configService: IConfigService) {
        if (!configService.getConfig().cursor.disable) {
            this.internalCursor = {
                anchor: 0,
                head: 0,
                leftLock: 0,
            };
        }
    }

    get hasCursor() {
        return !!this.cursor;
    }

    get cursor() {
        this.assertCursor();
        return { ...this.internalCursor! };
    }

    set(anchor: number, head: number) {
        this.assertCursor();
        this.internalCursor = {
            anchor,
            head,
            leftLock: this.internalCursor!.leftLock,
        };
        this.didUpdateEventEmitter.emit({});
    }

    setLeftLock(leftLock: number) {
        this.assertCursor();
        this.internalCursor = {
            anchor: this.internalCursor!.anchor,
            head: this.internalCursor!.head,
            leftLock,
        };
    }

    applyChange(change: ICursorChange) {
        const changeResult = change.apply(this);
        this.didUpdateEventEmitter.emit({});
        return changeResult;
    }

    onDidUpdate(listener: IEventListener<IDidUpdateCursorEvent>) {
        return this.didUpdateEventEmitter.on(listener);
    }

    protected assertCursor() {
        if (!this.cursor) {
            throw new Error('Cursor is disabled.');
        }
    }
}
