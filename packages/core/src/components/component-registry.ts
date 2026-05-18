import type { ComponentDefinition } from "./component-definition";

/**
 * Component registry for the new render pipeline. Constructor-injectable
 * per Decision F. Mutable via `register`; consumed by the new renderer
 * via `get` / `has`.
 *
 * Two factory functions:
 *   - createComponentRegistry(): empty registry; tests use it to isolate
 *     behavior (register only the components under test).
 *   - createDefaultComponentRegistry(): empty in P7; P8 populates it with
 *     every migrated built-in component via explicit register() calls.
 *     No side-effect imports.
 */
export interface ComponentRegistry {
  register(def: ComponentDefinition): void;
  get(type: string): ComponentDefinition | undefined;
  has(type: string): boolean;
}

class ComponentRegistryImpl implements ComponentRegistry {
  private readonly defs = new Map<string, ComponentDefinition>();

  register(def: ComponentDefinition): void {
    this.defs.set(def.type, def);
  }
  get(type: string): ComponentDefinition | undefined {
    return this.defs.get(type);
  }
  has(type: string): boolean {
    return this.defs.has(type);
  }
}

export function createComponentRegistry(): ComponentRegistry {
  return new ComponentRegistryImpl();
}

/**
 * Returns a registry pre-populated with all built-in components. In P7
 * the registry is empty (no components are yet migrated to the new
 * ComponentDefinition union). P8 migrates each built-in component and
 * adds explicit `register()` calls here.
 */
export function createDefaultComponentRegistry(): ComponentRegistry {
  return createComponentRegistry();
  // P8 will replace with:
  //   const reg = createComponentRegistry();
  //   reg.register(documentComponent);
  //   reg.register(paragraphComponent);
  //   ... etc.
  //   return reg;
}
