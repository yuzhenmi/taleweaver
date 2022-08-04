import { ConfigService } from '../config/service';
import { TransformService } from '../transform/service';
import { HistoryState } from './state';

export class HistoryService {
    protected state: HistoryState;

    constructor(configService: ConfigService, transformService: TransformService) {
        this.state = new HistoryState(configService, transformService);
    }

    undo() {
        this.state.undo();
    }

    redo() {
        this.state.redo();
    }
}
