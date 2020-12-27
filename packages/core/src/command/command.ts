import { IServices } from '../service/registry';

export interface ICommandHandler {
    handle(...args: any): Promise<any>;
}

type IInjectableServiceName = keyof IServices;

export interface ICommandHandlerClass {
    readonly dependencies: readonly IInjectableServiceName[];

    new (...args: any): ICommandHandler;
}
