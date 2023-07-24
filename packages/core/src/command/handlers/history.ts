import { HistoryService } from '../../history/service';
import { CommandHandler } from '../command';

export class UndoCommandHandler implements CommandHandler {
    static dependencies = ['history'] as const;

    constructor(protected historyService: HistoryService) {}

    async handle() {
        this.historyService.undo();
    }
}

export class RedoCommandHandler implements CommandHandler {
    static dependencies = ['history'] as const;

    constructor(protected historyService: HistoryService) {}

    async handle() {
        this.historyService.redo();
    }
}
