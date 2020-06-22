import { IComponent } from './component';
import { ILineComponent } from './line-component';
import { IPageComponent } from './page-component';

export interface IComponentRegistry {
    registerComponent(componentId: string, component: IComponent): void;
    registerPageComponent(pageComponent: IPageComponent): void;
    registerLineComponent(lineComponent: ILineComponent): void;
    getComponent(componentId: string): IComponent;
    getPageComponent(): IPageComponent;
    getLineComponent(): ILineComponent;
}

export class ComponentRegistry implements IComponentRegistry {
    protected componentsMap: Map<string, IComponent> = new Map();
    protected pageComponent?: IPageComponent;
    protected lineComponent?: ILineComponent;

    registerComponent(componentId: string, component: IComponent) {
        this.componentsMap.set(componentId, component);
    }

    registerPageComponent(pageComponent: IPageComponent) {
        this.pageComponent = pageComponent;
    }

    registerLineComponent(lineComponent: ILineComponent) {
        this.lineComponent = lineComponent;
    }

    getComponent(componentId: string) {
        const component = this.componentsMap.get(componentId);
        if (!component) {
            throw new Error(`Component ${componentId} is not registered.`);
        }
        return component;
    }

    getPageComponent() {
        if (!this.pageComponent) {
            throw new Error('Page component is not registered.');
        }
        return this.pageComponent;
    }

    getLineComponent() {
        if (!this.lineComponent) {
            throw new Error('Line component is not registered.');
        }
        return this.lineComponent;
    }
}
