import { IConfigService } from 'tw/config/service';

export interface IServiceRegistry {
    getConfigService(): IConfigService;
}

export interface IServices {
    readonly config: IConfigService;
}

export class ServiceRegistry implements IServiceRegistry {
    protected services: IServices;

    constructor(services: IServices) {
        this.services = services;
    }

    getConfigService() {
        return this.services.config;
    }
}
