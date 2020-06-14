import { IConfigService } from '../config/service';
import { IModelService } from '../model/service';
import { HistoryState, IHistoryState } from './state';

export interface IHistoryService {
    undo(): void;
    redo(): void;
}

export class HistoryService implements IHistoryService {
    protected state: IHistoryState;

    constructor(configService: IConfigService, modelService: IModelService) {
        this.state = new HistoryState(configService, modelService);
    }

    undo() {
        this.state.undo();
    }

    redo() {
        this.state.redo();
    }
}
