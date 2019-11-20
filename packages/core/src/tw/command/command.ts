import { IServiceRegistry } from 'tw/service/registry';

export interface ICommandHandler {
    (serviceRegistry: IServiceRegistry, ...args: any[]): Promise<void>;
}
