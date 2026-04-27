import type { StateNode } from "../state/state-node";
import type { RenderNode } from "./render-node";
import type { ComponentRegistry } from "../components/component-registry";

/** Render the state tree to a render tree, bottom-up. */
export function renderTree(state: StateNode, registry: ComponentRegistry): RenderNode {
  const def = registry.get(state.type);
  if (!def) throw new Error(`No render function for type "${state.type}"`);
  const children = state.children.map((c) => renderTree(c, registry));
  return def.render(state, children);
}
