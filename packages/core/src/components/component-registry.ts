import type { ComponentDefinition } from "./component-definition";
import type { BlockKind, BlockKindResolver } from "../state";
import { documentComponent } from "./document";
import { sectionComponent } from "./section";
import { templateBodyComponent } from "./template-body";
import { footnoteBodyComponent } from "./footnote-body";
import { paragraphComponent } from "./paragraph";
import { headingComponent } from "./heading";
import { listItemComponent } from "./list-item";
import { tableComponent } from "./table";
import { tableRowComponent } from "./table-row";
import { tableCellComponent } from "./table-cell";
import { imageComponent } from "./image";
import { horizontalLineComponent } from "./horizontal-line";
import { tableOfContentsComponent } from "./table-of-contents";

/**
 * Component registry for the new render pipeline. Constructor-injectable
 * per Decision F. Mutable via `register`; consumed by the new renderer
 * via `get` / `has`.
 *
 * Also implements `BlockKindResolver` from the state module: `getBlockKind`
 * maps a type string to its `BlockKind` by reading the registered
 * definition's `kind` (container) or `leafShape` (inline-bearing vs
 * atomic). State ops that need to judge shape (e.g., `setBlockType`'s
 * cross-kind refusal) accept the resolver — the state module stays free
 * of component-type knowledge.
 *
 * Two factory functions:
 *   - createComponentRegistry(): empty registry; tests use it to isolate
 *     behavior (register only the components under test).
 *   - createDefaultComponentRegistry(): empty in P7; P8 populates it with
 *     every migrated built-in component via explicit register() calls.
 *     No side-effect imports.
 */
export interface ComponentRegistry extends BlockKindResolver {
  register(def: ComponentDefinition): void;
  get(type: string): ComponentDefinition | undefined;
  has(type: string): boolean;
  /** Map a type string to its BlockKind. Returns null if unregistered. */
  getBlockKind(type: string): BlockKind | null;
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
  getBlockKind(type: string): BlockKind | null {
    const def = this.defs.get(type);
    if (def === undefined) return null;
    if (def.kind === "container") return "container";
    return def.leafShape === "inline-bearing" ? "inline-bearing-leaf" : "atomic-leaf";
  }
}

export function createComponentRegistry(): ComponentRegistry {
  return new ComponentRegistryImpl();
}

/**
 * Returns a registry pre-populated with all built-in components.
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
  reg.register(sectionComponent);
  reg.register(templateBodyComponent);
  reg.register(footnoteBodyComponent);
  reg.register(tableComponent);
  reg.register(tableRowComponent);
  reg.register(tableCellComponent);
  // Leaves
  reg.register(paragraphComponent);
  reg.register(headingComponent);
  reg.register(listItemComponent);
  reg.register(imageComponent);
  reg.register(horizontalLineComponent);
  reg.register(tableOfContentsComponent);
  return reg;
}
