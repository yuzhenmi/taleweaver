import { IConfigService } from '../config/service';
import { IModelNode } from '../model/node';
import { IResolvedModelPosition } from '../model/position';
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
    convertModelToDOM(
        modelNode: IModelNode<any>,
        from: IResolvedModelPosition,
        to: IResolvedModelPosition,
    ): HTMLElement;
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

    convertModelToDOM(node: IModelNode<any>, from: IResolvedModelPosition | null, to: IResolvedModelPosition | null) {
        const fromOffset = from ? from[0].offset : 0;
        const toOffset = to ? to[0].offset : node.contentLength - 1;
        const component = this.getComponent(node.componentId);
        if (node.leaf) {
            return component.toDOM(node.partId, node.attributes, node.text.substring(fromOffset, toOffset), []);
        }
        const domChildren: HTMLElement[] = [];
        for (let n = fromOffset; n <= toOffset; n++) {
            const child = node.children.at(n);
            domChildren.push(
                this.convertModelToDOM(
                    child,
                    from && n === fromOffset ? from.slice(1) : null,
                    to && n === toOffset ? to.slice(1) : null,
                ),
            );
        }
        return component.toDOM(node.partId, node.attributes, '', domChildren);
    }
}
