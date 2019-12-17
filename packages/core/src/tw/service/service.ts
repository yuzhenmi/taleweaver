import { IServiceRegistry } from 'tw/service/registry';

export interface IService {}

export interface IServiceClass {
    new (serviceRegistry: IServiceRegistry): IService;
}
