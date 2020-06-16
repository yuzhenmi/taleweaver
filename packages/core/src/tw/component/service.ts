import { IConfigService } from '../config/service';
import { IServiceRegistry } from '../service/registry';
import { IComponent } from './component';
import { LineComponent } from './components/line';
import { PageComponent } from './components/page';
import { ILineComponent } from './line-component';
import { IPageComponent } from './page-component';
import { ComponentRegistry, IComponentRegistry } from './registry';

export interface IComponentService {
    getComponent(componentId: string): IComponent;
    getPageComponent(): IPageComponent;
    getLineComponent(): ILineComponent;
}

export class ComponentService implements IComponentService {
    protected registry: IComponentRegistry = new ComponentRegistry();

    constructor(protected configService: IConfigService, protected serviceRegistry: IServiceRegistry) {
        for (let [componentId, Component] of Object.entries(configService.getConfig().components)) {
            this.registry.registerComponent(componentId, new Component(componentId, serviceRegistry));
        }
        this.registry.registerPageComponent(new PageComponent('page', serviceRegistry));
        this.registry.registerLineComponent(new LineComponent('line', serviceRegistry));
    }

    getComponent(componentId: string) {
        return this.registry.getComponent(componentId);
    }

    getPageComponent() {
        return this.registry.getPageComponent();
    }

    getLineComponent() {
        return this.registry.getLineComponent();
    }
}
