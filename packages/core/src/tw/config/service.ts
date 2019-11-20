import { IConfig, IExternalConfig } from 'tw/config/config';

export interface IConfigService {
    getConfig(): IConfig;
}

export class ConfigService implements IConfigService {
    protected config: IConfig;

    constructor(config: IConfig, externalConfig: IExternalConfig) {
        this.config = config;
        this.applyExternalConfig(externalConfig);
    }

    getConfig() {
        return this.config;
    }

    protected applyExternalConfig(externalConfig: IExternalConfig) {
        // TODO
    }
}
