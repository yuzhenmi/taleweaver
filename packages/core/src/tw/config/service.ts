import { IConfig, IExternalConfig } from './config';

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
        const coreConfig = externalConfig['tw.core'];
        if (coreConfig) {
            if (coreConfig.page) {
                this.config.page = coreConfig.page;
            }
        }
    }
}
