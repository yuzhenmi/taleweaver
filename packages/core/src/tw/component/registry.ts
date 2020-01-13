import { IComponent } from './component';

export interface IComponentRegistry {
    registerComponent(componentId: string, component: IComponent): void;
    getComponent(componentId: string): IComponent | undefined;
}

export class ComponentRegistry implements IComponentRegistry {
    protected componentsMap: Map<string, IComponent> = new Map();

    registerComponent(componentId: string, component: IComponent) {
        this.componentsMap.set(componentId, component);
    }

    getComponent(componentId: string) {
        return this.componentsMap.get(componentId);
    }
}
