import { Component } from './component';

export class ComponentRegistry {
    protected componentsMap: Map<string, Component<unknown>> = new Map();

    registerComponent(componentId: string, component: Component<unknown>) {
        this.componentsMap.set(componentId, component);
    }

    getComponent(componentId: string) {
        const component = this.componentsMap.get(componentId);
        if (!component) {
            throw new Error(`Component ${componentId} is not registered.`);
        }
        return component;
    }
}
