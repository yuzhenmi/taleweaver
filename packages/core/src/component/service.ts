import { ConfigService } from '../config/service';
import { ComponentRegistry } from './registry';

export class ComponentService {
    protected registry: ComponentRegistry = new ComponentRegistry();

    constructor(configService: ConfigService) {
        for (const [componentId, component] of Object.entries(configService.getConfig().components)) {
            this.registry.registerComponent(componentId, component);
        }
    }

    getComponent(componentId: string) {
        return this.registry.getComponent(componentId);
    }
}
