import { IComponent } from 'tw/component/component';
import { LineComponent } from 'tw/component/components/line';
import { PageComponent } from 'tw/component/components/page';
import { IPageComponent } from 'tw/component/page-component';
import { ComponentRegistry, IComponentRegistry } from 'tw/component/registry';
import { IConfigService } from 'tw/config/service';
import { IService } from 'tw/service/service';
import { ILineComponent } from './line-component';

export interface IComponentService extends IService {
    getPageComponent(): IPageComponent;
    getLineComponent(): ILineComponent;
    getComponent(componentId: string): IComponent | undefined;
}

export class ComponentService implements IComponentService {
    protected pageComponent = new PageComponent('$page');
    protected lineComponent = new LineComponent('$line');
    protected registry: IComponentRegistry = new ComponentRegistry();

    constructor(configService: IConfigService) {
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
