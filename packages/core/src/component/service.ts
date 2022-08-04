import { ConfigService } from '../config/service';
import { ComponentRegistry } from './registry';

export class ComponentService {
    protected registry: ComponentRegistry = new ComponentRegistry();

    constructor(configService: ConfigService) {
        configService.getConfig().components.forEach((component) => {
            this.registry.registerComponent(component);
        });
    }

    getComponent<TAttributes>(componentId: string) {
        return this.registry.getComponent<TAttributes>(componentId);
    }
}
