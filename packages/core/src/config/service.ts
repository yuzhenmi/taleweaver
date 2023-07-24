import { Config, ExternalConfig } from './config';

export class ConfigService {
    protected config: Config;

    constructor(config: Config, externalConfig: ExternalConfig) {
        this.config = config;
        this.applyExternalConfig(externalConfig);
    }

    getConfig() {
        return this.config;
    }

    protected applyExternalConfig(externalConfig: ExternalConfig) {
        const coreConfig = externalConfig['tw.core'];
        if (coreConfig) {
            // TODO
        }
    }
}
