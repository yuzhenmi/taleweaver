import { IServiceRegistry } from '../service/registry';

export interface ICommandHandler {
    (serviceRegistry: IServiceRegistry, ...args: any[]): Promise<void>;
}
