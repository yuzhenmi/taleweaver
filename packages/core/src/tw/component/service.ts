import { IConfigService } from '../config/service';
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

    constructor(configService: IConfigService) {
        for (let [componentId, component] of Object.entries(configService.getConfig().components)) {
            this.registry.registerComponent(componentId, component);
        }
        this.registry.registerPageComponent(new PageComponent('page', configService));
        this.registry.registerLineComponent(new LineComponent('line'));
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
