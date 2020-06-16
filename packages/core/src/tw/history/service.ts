import { IConfigService } from '../config/service';
import { ITransformService } from '../transform/service';
import { HistoryState, IHistoryState } from './state';

export interface IHistoryService {
    undo(): void;
    redo(): void;
}

export class HistoryService implements IHistoryService {
    protected state: IHistoryState;

    constructor(configService: IConfigService, transformService: ITransformService) {
        this.state = new HistoryState(configService, transformService);
    }

    undo() {
        this.state.undo();
    }

    redo() {
        this.state.redo();
    }
}
