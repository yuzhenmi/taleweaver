import { ConfigService } from '../config/service';
import { EventListener } from '../event/listener';
import { Cursor, DidUpdateCursorEvent } from './cursor';

const noOpDisposable = {
    dispose: () => {},
};

export class CursorService {
    protected cursor: Cursor | null = null;

    constructor(configService: ConfigService) {
        if (!configService.getConfig().cursor.disable) {
            this.cursor = new Cursor();
        }
    }

    getCursor() {
        return this.cursor;
    }

    setCursor(anchor: number, head: number) {
        this.cursor?.setAnchor(anchor);
        this.cursor?.setHead(head);
    }

    setLeftLock(leftLock: number) {
        this.cursor?.setLeftLock(leftLock);
    }

    onDidUpdate(listener: EventListener<DidUpdateCursorEvent>) {
        return this.cursor?.onDidUpdate(listener) ?? noOpDisposable;
    }
}
