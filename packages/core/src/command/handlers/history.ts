import { IHistoryService } from '../../history/service';
import { ICommandHandler } from '../command';

export class UndoCommandHandler implements ICommandHandler {
    static dependencies = ['history'] as const;

    constructor(protected historyService: IHistoryService) {}

    async handle() {
        this.historyService.undo();
    }
}

export class RedoCommandHandler implements ICommandHandler {
    static dependencies = ['history'] as const;

    constructor(protected historyService: IHistoryService) {}

    async handle() {
        this.historyService.redo();
    }
}
