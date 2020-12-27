import { IConfigService } from '../config/service';
import { IComponent } from './component';
import { ComponentRegistry, IComponentRegistry } from './registry';

export interface IComponentService {
    getComponent<TAttributes>(componentId: string): IComponent<TAttributes>;
}

export class ComponentService implements IComponentService {
    protected registry: IComponentRegistry = new ComponentRegistry();

    constructor(configService: IConfigService) {
        configService.getConfig().components.forEach((component) => {
            this.registry.registerComponent(component);
        });
    }

    getComponent<TAttributes>(componentId: string) {
        return this.registry.getComponent<TAttributes>(componentId);
    }
}
