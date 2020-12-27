import { IComponent } from './component';

export interface IComponentRegistry {
    registerComponent(component: IComponent<any>): void;
    getComponent<TAttributes>(componentId: string): IComponent<TAttributes>;
}

export class ComponentRegistry implements IComponentRegistry {
    protected componentsMap: Map<string, IComponent<any>> = new Map();

    registerComponent(component: IComponent<any>) {
        this.componentsMap.set(component.id, component);
    }

    getComponent<TAttributes>(componentId: string) {
        const component = this.componentsMap.get(componentId);
        if (!component) {
            throw new Error(`Component ${componentId} is not registered.`);
        }
        return component as IComponent<TAttributes>;
    }
}
