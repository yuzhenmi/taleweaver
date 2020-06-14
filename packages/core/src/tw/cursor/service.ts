import { IConfigService } from '../config/service';
import { IEventListener } from '../event/listener';
import { Cursor, ICursor, IDidUpdateCursorEvent } from './cursor';

export interface ICursorState {
    readonly anchor: number;
    readonly head: number;
}

export interface ICursorService {
    hasCursor(): boolean;
    getState(): ICursorState;
    setState(state: ICursorState): void;
    getLeftLock(): number | null;
    setLeftLock(leftLock: number | null): void;
    onDidUpdateCursor(listener: IEventListener<IDidUpdateCursorEvent>): void;
}

export class CursorService implements ICursorService {
    protected cursor?: ICursor;

    constructor(configService: IConfigService) {
        if (!configService.getConfig().cursor.disable) {
            this.cursor = new Cursor();
        }
    }

    hasCursor() {
        return !!this.cursor;
    }

    getState() {
        this.assertCursor();
        return {
            anchor: this.cursor!.anchor,
            head: this.cursor!.head,
        };
    }

    setState(state: ICursorState) {
        this.assertCursor();
        this.cursor!.set(state.anchor, state.head);
    }

    getLeftLock() {
        this.assertCursor();
        return this.cursor!.leftLock;
    }

    setLeftLock(leftLock: number) {
        this.assertCursor();
        this.cursor!.leftLock = leftLock;
    }

    onDidUpdateCursor(listener: IEventListener<IDidUpdateCursorEvent>) {
        if (this.cursor) {
            this.cursor.onDidUpdateCursor(listener);
        }
    }

    protected assertCursor() {
        if (!this.cursor) {
            throw new Error('Cursor is disabled.');
        }
    }
}
