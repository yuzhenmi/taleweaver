import { IConfigService } from '../config/service';
import { IEventListener, IOnEvent } from '../event/listener';
import { IModelService } from '../model/service';
import { IRenderService } from '../render/service';
import { CursorState, ICursor, ICursorState, IDidUpdateCursorStateEvent } from './state';

export interface ICursorService {
    hasCursor(): boolean;
    getCursor(): ICursor;
    setCursor(anchor: number, head: number): void;
    setLeftLock(leftLock: number): void;
    onDidUpdate: IOnEvent<IDidUpdateCursorStateEvent>;
}

export class CursorService implements ICursorService {
    protected state: ICursorState;

    constructor(configService: IConfigService, renderService: IRenderService, modelService: IModelService) {
        this.state = new CursorState(configService, renderService, modelService);
    }

    hasCursor() {
        return this.state.hasCursor;
    }

    getCursor() {
        return this.state.cursor;
    }

    setCursor(anchor: number, head: number) {
        this.state.set(anchor, head);
    }

    setLeftLock(leftLock: number) {
        this.state.setLeftLock(leftLock);
    }

    onDidUpdate(listener: IEventListener<IDidUpdateCursorStateEvent>) {
        return this.state.onDidUpdate(listener);
    }
}
