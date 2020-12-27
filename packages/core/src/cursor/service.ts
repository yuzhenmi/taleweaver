import { IConfigService } from '../config/service';
import { IEventListener, IOnEvent } from '../event/listener';
import { Cursor, ICursor, IDidUpdateCursorEvent } from './cursor';

export interface ICursorService {
    getCursor(): ICursor | null;
    setCursor(anchor: number, head: number): void;
    setLeftLock(leftLock: number): void;
    onDidUpdate: IOnEvent<IDidUpdateCursorEvent>;
}

const noOpDisposable = {
    dispose: () => {},
};

export class CursorService implements ICursorService {
    protected cursor: ICursor | null = null;

    constructor(configService: IConfigService) {
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

    onDidUpdate(listener: IEventListener<IDidUpdateCursorEvent>) {
        return this.cursor?.onDidUpdate(listener) ?? noOpDisposable;
    }
}
