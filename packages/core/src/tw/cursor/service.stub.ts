import { IEventListener } from '../event/listener';
import { Cursor, IDidUpdateCursorEvent } from './cursor';
import { ICursorService, ICursorState } from './service';

export class CursorServiceStub implements ICursorService {
    protected cursor = new Cursor();

    onDidUpdateCursor(listener: IEventListener<IDidUpdateCursorEvent>) {
        if (this.cursor) {
            this.cursor.onDidUpdateCursor(listener);
        }
    }

    hasCursor() {
        return true;
    }

    setCursorState(cursorState: ICursorState) {
        this.cursor!.set(cursorState.anchor, cursorState.head, cursorState.leftLock);
    }

    getCursorState() {
        return {
            anchor: this.cursor!.getAnchor(),
            head: this.cursor!.getHead(),
            leftLock: this.cursor!.getLeftLock(),
        };
    }
}
