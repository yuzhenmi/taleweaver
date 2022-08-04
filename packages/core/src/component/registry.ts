import { Component } from './component';

export class ComponentRegistry {
    protected componentsMap: Map<string, Component<any>> = new Map();

    registerComponent(component: Component<any>) {
        this.componentsMap.set(component.id, component);
    }

    getComponent<TAttributes>(componentId: string) {
        const component = this.componentsMap.get(componentId);
        if (!component) {
            throw new Error(`Component ${componentId} is not registered.`);
        }
        return component as Component<TAttributes>;
    }
}
