import { ConfigService } from '../config/service';
import { EventEmitter } from '../event/emitter';
import { EventListener } from '../event/listener';
import { ServiceRegistry } from '../service/registry';
import { CommandRegistry } from './registry';

export interface WillExecuteCommandEvent {
    readonly commandId: string;
    readonly args: any[];
}

export interface DidExecuteCommandEvent {
    readonly commandId: string;
    readonly args: any[];
}

export class CommandService {
    protected willExecuteCommandEventEmitter = new EventEmitter<WillExecuteCommandEvent>();
    protected didExecuteCommandEventEmitter = new EventEmitter<DidExecuteCommandEvent>();
    protected registry: CommandRegistry = new CommandRegistry();

    constructor(configService: ConfigService, protected serviceRegistry: ServiceRegistry) {
        // HACK: Let service registry initialize before registering commands
        setTimeout(() => {
            for (let [commandId, CommandHandler] of Object.entries(configService.getConfig().commands)) {
                const services = CommandHandler.dependencies.map((dependency) =>
                    this.serviceRegistry.getService(dependency),
                );
                this.registry.registerCommand(commandId, new CommandHandler(...services));
            }
        });
    }

    onWillExecuteCommand(listener: EventListener<WillExecuteCommandEvent>) {
        return this.willExecuteCommandEventEmitter.on(listener);
    }

    onDidExecuteCommand(listener: EventListener<DidExecuteCommandEvent>) {
        return this.didExecuteCommandEventEmitter.on(listener);
    }

    async executeCommand(commandId: string, ...args: any[]) {
        const commandHandler = this.registry.getCommandHandler(commandId);
        if (!commandHandler) {
            return;
        }
        this.willExecuteCommandEventEmitter.emit({ commandId, args });
        await commandHandler.handle(...args);
        this.didExecuteCommandEventEmitter.emit({ commandId, args });
    }
}
