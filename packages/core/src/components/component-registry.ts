import type { ComponentDefinition } from "./component-definition";

/** Registry mapping component type strings to component definitions. */
export class ComponentRegistry {
  private readonly defs = new Map<string, ComponentDefinition>();

  register(definition: ComponentDefinition): void {
    this.defs.set(definition.type, definition);
  }

  get(type: string): ComponentDefinition | undefined {
    return this.defs.get(type);
  }

  has(type: string): boolean {
    return this.defs.has(type);
  }
}

/** Build a component registry from component definitions. */
export function createRegistry(
  components: readonly ComponentDefinition[],
): ComponentRegistry {
  const registry = new ComponentRegistry();

  for (const comp of components) {
    registry.register(comp);
  }

  return registry;
}
