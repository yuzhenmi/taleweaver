import { IExtensionConfig, IExternalConfig, IInternalConfig } from 'tw/config/config';
import { IServiceRegistry } from 'tw/service/registry';
import { IService } from 'tw/service/service';
import { Cursor, ICursor } from './cursor';

export interface ICursorState {
    readonly anchor: number;
    readonly head: number;
    readonly leftLock: number | null;
}

export interface ICursorService extends IService {
    hasCursor(): boolean;
    setCursorState(cursorState: ICursorState): void;
    getCursorState(): ICursorState;
}

export class CursorService implements ICursorService {
    protected cursor?: ICursor;

    constructor(
        protected serviceRegistry: IServiceRegistry,
        internalConfig: IInternalConfig,
        extensionConfigs: IExtensionConfig[],
        externalConfig: IExternalConfig,
    ) {
        if (!externalConfig['tw.core'].disableCursor) {
            this.cursor = new Cursor();
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
