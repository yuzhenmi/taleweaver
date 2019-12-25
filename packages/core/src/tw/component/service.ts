import { IConfigService } from '../config/service';
import { IComponent } from './component';
import { LineComponent } from './components/line';
import { PageComponent } from './components/page';
import { ILineComponent } from './line-component';
import { IPageComponent } from './page-component';
import { ComponentRegistry, IComponentRegistry } from './registry';

export interface IComponentService {
    getPageComponent(): IPageComponent;
    getLineComponent(): ILineComponent;
    getComponent(componentId: string): IComponent | undefined;
}

export class ComponentService implements IComponentService {
    protected pageComponent: IPageComponent;
    protected lineComponent: ILineComponent;
    protected registry: IComponentRegistry = new ComponentRegistry();

    constructor(configService: IConfigService) {
        this.pageComponent = new PageComponent('page', configService);
        this.lineComponent = new LineComponent('line');
        for (let [componentId, component] of Object.entries(configService.getConfig().components)) {
            this.registry.registerComponent(componentId, component);
        }
        this.registry.registerComponent(this.pageComponent.getId(), this.pageComponent);
        this.registry.registerComponent(this.lineComponent.getId(), this.lineComponent);
    }

    getComponent(componentId: string) {
        return this.registry.getComponent(componentId);
    }

    getPageComponent() {
        return this.pageComponent;
    }

    getLineComponent() {
        return this.lineComponent;
    }
}
