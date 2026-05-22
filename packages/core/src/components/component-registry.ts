import type { ComponentDefinition } from "./component-definition";
import { documentComponent } from "./document";
import { paragraphComponent } from "./paragraph";
import { headingComponent } from "./heading";
import { listComponent } from "./list";
import { listItemComponent } from "./list-item";
import { tableComponent } from "./table";
import { tableRowComponent } from "./table-row";
import { tableCellComponent } from "./table-cell";
import { imageComponent } from "./image";
import { horizontalLineComponent } from "./horizontal-line";

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
 * Returns a registry pre-populated with all 10 built-in components.
 * Per Decision F: explicit register() calls, no side-effect imports.
 *
 * `text` and `span` are deliberately NOT registered — per master spec,
 * `componentRegistry.has("text") === false`, `has("span") === false`
 * for the new pipeline. The renderer expands inline items directly.
 */
export function createDefaultComponentRegistry(): ComponentRegistry {
  const reg = createComponentRegistry();
  // Containers
  reg.register(documentComponent);
  reg.register(listComponent);
  reg.register(tableComponent);
  reg.register(tableRowComponent);
  reg.register(tableCellComponent);
  // Leaves
  reg.register(paragraphComponent);
  reg.register(headingComponent);
  reg.register(listItemComponent);
  reg.register(imageComponent);
  reg.register(horizontalLineComponent);
  return reg;
}
