import { IConfigService } from '../config/service';
import { EventEmitter } from '../event/emitter';
import { IEventListener, IOnEvent } from '../event/listener';
import { IModelService } from '../model/service';
import { IRenderService } from '../render/service';
import { ICursorChange, ICursorChangeResult } from './change/change';

export interface ICursor {
    anchor: number;
    head: number;
    leftLock: number;
}

export interface IDidUpdateCursorStateEvent {}

export interface ICursorState {
    readonly hasCursor: boolean;
    readonly cursor: ICursor;

    set(anchor: number, head: number): void;
    setLeftLock(leftLock: number): void;
    applyChange(change: ICursorChange): ICursorChangeResult;
    onDidUpdate: IOnEvent<IDidUpdateCursorStateEvent>;
}

export class CursorState {
    protected internalCursor: ICursor | null = null;
    protected didUpdateEventEmitter = new EventEmitter<IDidUpdateCursorStateEvent>();

    constructor(
        configService: IConfigService,
        protected renderService: IRenderService,
        protected modelService: IModelService,
    ) {
        if (!configService.getConfig().cursor.disable) {
            this.internalCursor = {
                anchor: 0,
                head: 0,
                leftLock: 0,
            };
        }
    }

    get hasCursor() {
        return !!this.internalCursor;
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
        const changeResult = change.apply(this, this.modelService, this.renderService);
        this.didUpdateEventEmitter.emit({});
        return changeResult;
    }

    onDidUpdate(listener: IEventListener<IDidUpdateCursorStateEvent>) {
        return this.didUpdateEventEmitter.on(listener);
    }

    protected assertCursor() {
        if (!this.internalCursor) {
            throw new Error('Cursor is disabled.');
        }
    }
}
