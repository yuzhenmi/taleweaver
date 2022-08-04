import { CommandHandler } from './command';

export class CommandRegistry {
    protected commandsMap: Map<string, CommandHandler> = new Map();

    registerCommand(commandId: string, commandHandler: CommandHandler) {
        this.commandsMap.set(commandId, commandHandler);
    }

    getCommandHandler(commandId: string) {
        return this.commandsMap.get(commandId);
    }
}
