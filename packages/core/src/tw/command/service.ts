import { IConfigService } from '../config/service';
import { EventEmitter } from '../event/emitter';
import { IEventListener, IOnEvent } from '../event/listener';
import { IServiceRegistry } from '../service/registry';
import { CommandRegistry, ICommandRegistry } from './registry';

export interface IWillExecuteCommandEvent {
    readonly commandId: string;
    readonly args: any[];
}

export interface IDidExecuteCommandEvent {
    readonly commandId: string;
    readonly args: any[];
}

export interface ICommandService {
    onWillExecuteCommand: IOnEvent<IWillExecuteCommandEvent>;
    onDidExecuteCommand: IOnEvent<IDidExecuteCommandEvent>;
    executeCommand(commandId: string, ...args: any[]): Promise<void>;
}

export class CommandService implements ICommandService {
    protected willExecuteCommandEventEmitter = new EventEmitter<IWillExecuteCommandEvent>();
    protected didExecuteCommandEventEmitter = new EventEmitter<IDidExecuteCommandEvent>();
    protected registry: ICommandRegistry = new CommandRegistry();

    constructor(configService: IConfigService, protected serviceRegistry: IServiceRegistry) {
        for (let [commandId, commandHandler] of Object.entries(configService.getConfig().commands)) {
            this.registry.registerCommand(commandId, commandHandler);
        }
    }

    onWillExecuteCommand(listener: IEventListener<IWillExecuteCommandEvent>) {
        return this.willExecuteCommandEventEmitter.on(listener);
    }

    onDidExecuteCommand(listener: IEventListener<IDidExecuteCommandEvent>) {
        return this.didExecuteCommandEventEmitter.on(listener);
    }

    async executeCommand(commandId: string, ...args: any[]) {
        const commandHandler = this.registry.getCommandHandler(commandId);
        if (!commandHandler) {
            return;
        }
        this.willExecuteCommandEventEmitter.emit({ commandId, args });
        await commandHandler(this.serviceRegistry, ...args);
        this.didExecuteCommandEventEmitter.emit({ commandId, args });
    }
}
