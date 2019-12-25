import { ICommandHandler } from './command';

export interface ICommandRegistry {
    registerCommand(commandId: string, handler: ICommandHandler): void;
    getCommandHandler(commandId: string): ICommandHandler | undefined;
}

export class CommandRegistry implements ICommandRegistry {
    protected commandsMap: Map<string, ICommandHandler> = new Map();

    registerCommand(commandId: string, commandHandler: ICommandHandler) {
        this.commandsMap.set(commandId, commandHandler);
    }

    getCommandHandler(commandId: string) {
        return this.commandsMap.get(commandId);
    }
}
