import { Services } from '../service/registry';

export interface CommandHandler {
    handle(...args: any): Promise<any>;
}

type InjectableServiceName = keyof Services;

export interface CommandHandlerClass {
    readonly dependencies: readonly InjectableServiceName[];

    new (...args: any): CommandHandler;
}
