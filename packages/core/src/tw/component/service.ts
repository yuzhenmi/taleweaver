import { IComponent } from 'tw/component/component';
import { ComponentRegistry, IComponentRegistry } from 'tw/component/registry';
import { IConfigService } from 'tw/config/service';
import { IService } from 'tw/service/service';

export interface IComponentService extends IService {
    getComponent(componentId: string): IComponent | undefined;
}

export class ComponentService implements IComponentService {
    protected registry: IComponentRegistry = new ComponentRegistry();

    constructor(configService: IConfigService) {
        for (let [componentId, component] of Object.entries(configService.getConfig().components)) {
            this.registry.registerComponent(componentId, component);
        }
    }

    getComponent(componentId: string) {
        return this.registry.getComponent(componentId);
    }
}
