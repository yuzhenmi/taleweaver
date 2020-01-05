import { IConfigService } from '../config/service';
import { IEventListener } from '../event/listener';
import { Cursor, ICursor, IDidUpdateCursorEvent } from './cursor';

export interface ICursorState {
    readonly anchor: number;
    readonly head: number;
    readonly leftLock: number | null;
}

export interface ICursorService {
    onDidUpdateCursor(listener: IEventListener<IDidUpdateCursorEvent>): void;
    hasCursor(): boolean;
    setCursorState(cursorState: ICursorState): void;
    getCursorState(): ICursorState;
}

export class CursorService implements ICursorService {
    protected cursor?: ICursor;

    constructor(configService: IConfigService) {
        if (!configService.getConfig().cursor.disable) {
            this.cursor = new Cursor();
        }
    }

    onDidUpdateCursor(listener: IEventListener<IDidUpdateCursorEvent>) {
        if (this.cursor) {
            this.cursor.onDidUpdateCursor(listener);
        }
    }

    hasCursor() {
        return !!this.cursor;
    }

    setCursorState(cursorState: ICursorState) {
        this.assertCursor();
        this.cursor!.set(cursorState.anchor, cursorState.head, cursorState.leftLock);
    }

    getCursorState() {
        this.assertCursor();
        return {
            anchor: this.cursor!.getAnchor(),
            head: this.cursor!.getHead(),
            leftLock: this.cursor!.getLeftLock(),
        };
    }

    protected assertCursor() {
        if (!this.cursor) {
            throw new Error('Cursor is disabled.');
        }
    }
}
