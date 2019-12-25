import { IServiceRegistry } from './registry';

export interface IService {}

export interface IServiceClass {
    new (serviceRegistry: IServiceRegistry): IService;
}
