import { IConfigService } from '../config/service';
import { IStateService } from '../state/service';
import { HistoryState, IHistoryState } from './state';

export interface IHistoryService {
    undo(): void;
    redo(): void;
}

export class HistoryService implements IHistoryService {
    protected state: IHistoryState;

    constructor(configService: IConfigService, stateService: IStateService) {
        this.state = new HistoryState(configService, stateService);
    }

    undo() {
        this.state.undo();
    }

    redo() {
        this.state.redo();
    }
}
